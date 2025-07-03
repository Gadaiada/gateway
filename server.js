// server.js
import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import dayjs from "dayjs";
import cors from "cors";

dotenv.config();

// Validação mínima das variáveis de ambiente
const { ASAAS_TOKEN, PLAN_VALUE, PLAN_DESCRIPTION, PORT = 4000 } = process.env;
if (!ASAAS_TOKEN || !PLAN_VALUE || !PLAN_DESCRIPTION) {
  console.error(
    "[ERRO] Variáveis de ambiente ASAAS_TOKEN, PLAN_VALUE e PLAN_DESCRIPTION são obrigatórias!"
  );
  process.exit(1);
}

const app = express();

// Middleware CORS para permitir chamadas do front
app.use(cors());

// Middleware para interpretar JSON no webhook
app.use(express.json());

const ASAAS_BASE = "https://api.asaas.com/v3";

// Helper para chamadas à API Asaas
async function asaas(path, options = {}) {
  try {
    const res = await fetch(`${ASAAS_BASE}${path}`, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ASAAS_TOKEN}`, // Melhor usar Bearer token
        ...(options.headers || {}),
      },
      body: options.body ? JSON.stringify(options.body) : null,
    });

    const raw = await res.text();

    if (!res.ok) {
      console.error(`[Asaas ${res.status} ${path}] Resposta:`, raw);
      throw new Error(`Erro Asaas ${res.status}: ${raw}`);
    }

    if (!raw) return {};

    try {
      return JSON.parse(raw);
    } catch (err) {
      console.error(`[Falha parse JSON] ${path}:`, raw.slice(0, 200));
      throw new Error("Resposta Asaas inválida (não é JSON)");
    }
  } catch (err) {
    console.error(`[Fetch Asaas] Falha na requisição ${path}:`, err.message);
    throw err;
  }
}

// Busca cliente pelo email, cria se não existir
async function ensureCustomer({ email, name }) {
  const search = await asaas(`/customers?email=${encodeURIComponent(email)}`);
  if (search?.data?.length) {
    console.log(`[Cliente] Encontrado customer ID ${search.data[0].id} para email ${email}`);
    return search.data[0];
  }

  console.log(`[Cliente] Criando novo customer para email ${email}`);
  return asaas("/customers", {
    method: "POST",
    body: { email, name },
  });
}

// Rota raiz
app.get("/", (_, res) => res.json({ status: "online" }));

// Rota principal para gerar link de pagamento
console.log("Token Asaas usado:", process.env.ASAAS_TOKEN);
app.get("/checkout/asaas", async (req, res) => {
  const { email, name } = req.query;

  if (!email || !name) {
    return res
      .status(400)
      .json({ error: "Parâmetros email e name são obrigatórios" });
  }

  try {
    const customer = await ensureCustomer({ email, name });

    const subscription = await asaas("/subscriptions", {
      method: "POST",
      body: {
        customer: customer.id,
        billingType: "UNDEFINED",
        cycle: "MONTHLY",
        nextDueDate: dayjs().add(1, "day").format("YYYY-MM-DD"),
        value: Number(PLAN_VALUE),
        description: PLAN_DESCRIPTION,
      },
    });

    const link = await asaas("/paymentLinks", {
      method: "POST",
      body: {
        chargeType: "SUBSCRIPTION",
        subscription: subscription.id,
        name: PLAN_DESCRIPTION,
      },
    });

    console.log(`[Pagamento] Gerado link para ${email}: ${link.url}`);

    return res.json({ invoiceUrl: link.url });
  } catch (err) {
    console.error("[Erro checkout/asaas]:", err.message);
    return res.status(500).json({ error: "erro interno", message: err.message });
  }
});

// Webhook para receber notificações do Asaas
app.post("/webhook/asaas", (req, res) => {
  console.log("[Webhook Asaas] Evento recebido:", req.body);
  res.sendStatus(200);
});

// Inicia o servidor
app.listen(PORT, () => {
  console.log(`Servidor ON na porta ${PORT}`);
});
