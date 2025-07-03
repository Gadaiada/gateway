// server.js
import express from "express";
import dotenv   from "dotenv";
import fetch    from "node-fetch";   // node-fetch v3
import dayjs    from "dayjs";
import cors     from "cors";

dotenv.config();

const app  = express();
const PORT = process.env.PORT || 4000;

// ————————————————————————————————
// 1. Middleware
// ————————————————————————————————

// CORS simples para chamadas frontend
app.use(cors());

// Para receber JSON no webhook
app.use(express.json());

// ————————————————————————————————
// 2. Helpers
// ————————————————————————————————
const ASAAS_BASE = "https://api.asaas.com/v3";

// Wrapper que sempre devolve JSON ou lança erro com log detalhado
const asaas = async (path, { method = "GET", body = null } = {}) => {
  const res = await fetch(`${ASAAS_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      access_token: process.env.ASAAS_TOKEN,
    },
    body: body ? JSON.stringify(body) : null,
  });

  const raw = await res.text();         // corpo bruto (pode ser vazio)

  if (!res.ok) {
    console.error(`Asaas ${method} ${path} → ${res.status}`, raw);
    throw new Error(`Asaas ${res.status} ${path}`);
  }

  if (!raw) return {};                  // evita “Unexpected end of JSON input”

  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error(`Falha ao parsear JSON (${path}):`, raw.slice(0, 200));
    throw new Error("Resposta Asaas não‑JSON");
  }
};

// Busca cliente pelo e‑mail; cria se não existir
const ensureCustomer = async ({ email, name }) => {
  const search = await asaas(`/customers?email=${encodeURIComponent(email)}`);
  if (search?.data?.length) return search.data[0];

  return asaas("/customers", {
    method: "POST",
    body: { email, name },
  });
};

// ————————————————————————————————
// 3. Rotas
// ————————————————————————————————
app.get("/", (_, res) => res.json({ status: "online" }));

app.get("/checkout/asaas", async (req, res) => {
  const { email, name } = req.query;
  if (!email || !name)
    return res.status(400).json({ error: "Parâmetros email e name são obrigatórios" });

  try {
    // 1. cliente
    const customer = await ensureCustomer({ email, name });

    // 2. assinatura
    const subscription = await asaas("/subscriptions", {
      method: "POST",
      body: {
        customer: customer.id,
        billingType: "UNDEFINED",
        cycle: "MONTHLY",
        nextDueDate: dayjs().add(1, "day").format("YYYY-MM-DD"),
        value: Number(process.env.PLAN_VALUE),
        description: process.env.PLAN_DESCRIPTION,
      },
    });

    // 3. link de pagamento
    const link = await asaas("/paymentLinks", {
      method: "POST",
      body: {
        chargeType: "SUBSCRIPTION",
        subscription: subscription.id,
        name: process.env.PLAN_DESCRIPTION,
      },
    });

    return res.json({ invoiceUrl: link.url });
  } catch (e) {
    console.error("checkout/asaas erro:", e.message);
    return res.status(500).json({ error: "erro interno", message: e.message });
  }
});

// Webhook Asaas (apenas loga para testes)
app.post("/webhook/asaas", (req, res) => {
  console.log("Webhook Asaas recebido:", req.body);
  res.sendStatus(200);
});

// ————————————————————————————————
// 4. Start
// ————————————————————————————————
app.listen(PORT, () => console.log(`Servidor ON na porta ${PORT}`));
