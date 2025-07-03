// server.js – ponte Shopify / Webkul → Asaas
// Deploy grátis: Render, Railway, Vercel (funciona como "Serverless Function")

import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import dayjs from "dayjs";

dotenv.config();

const app = express();
app.use(express.json());

const ASAAS = "https://api.asaas.com/v3";
const HEADERS = {
  "Content-Type": "application/json",
  access_token: process.env.ASAAS_TOKEN,
};

/**
 * Retorna o ID do cliente no Asaas; cria se não existir.
 */
async function ensureCustomer(email, name) {
  const q = await fetch(`${ASAAS}/customers?email=${encodeURIComponent(email)}`, {
    headers: HEADERS,
  });
  const { data } = await q.json();
  if (data.length) return data[0].id;

  const r = await fetch(`${ASAAS}/customers`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ name, email }),
  });
  const created = await r.json();
  return created.id;
}

/**
 * Cria uma assinatura mensal e devolve o link da primeira cobrança
 */
async function createSubscription(customerId, value, description) {
  const nextDueDate = dayjs().add(1, "day").format("YYYY-MM-DD");

  const subResp = await fetch(`${ASAAS}/subscriptions`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      customer: customerId,
      billingType: "UNDEFINED", // habilita PIX + Cartão
      cycle: "MONTHLY",
      nextDueDate,
      value,
      description,
    }),
  });
  const sub = await subResp.json();

  const payResp = await fetch(`${ASAAS}/subscriptions/${sub.id}/payments`, {
    headers: HEADERS,
  });
  const payData = await payResp.json();
  return payData.data[0].invoiceUrl;
}

// ------------------------------------------------------------
// Rota chamada pelo botão no Webkul – ex: /checkout/asaas?email=x&name=y
// ------------------------------------------------------------
app.get("/checkout/asaas", async (req, res) => {
  try {
    const { email, name } = req.query;
    if (!email || !name) return res.status(400).json({ error: "email e name são obrigatórios" });

    const customerId = await ensureCustomer(email, name);
    const invoiceUrl = await createSubscription(
      customerId,
      Number(process.env.PLAN_VALUE),
      process.env.PLAN_DESCRIPTION,
    );

    return res.json({ invoiceUrl });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "erro interno", message: err.message });
  }
});

// ------------------------------------------------------------
// Webhook do Asaas
// ------------------------------------------------------------
app.post("/webhook/asaas", async (req, res) => {
  const evt = req.body;
  if (evt.event === "PAYMENT_CONFIRMED") {
    const customerId = evt.payment.customer;
    // TODO: mapear customerId → sellerId e ativar plano no Webkul via API
    console.log(`Pagamento confirmado para customer ${customerId}`);
  }
  res.sendStatus(200);
});

// Health‑check
app.get("/", (req, res) => res.json({ status: "online" }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Asaas bridge rodando em ${PORT}`));
