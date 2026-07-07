import { Router, type IRouter } from "express";
import OpenAI from "openai";

const router: IRouter = Router();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SYSTEM_PROMPT = `أنت GDN-AI، الذكاء الاصطناعي الرسمي لمنصة GDNA Arena للألعاب والكريبتو.

قواعد مهمة جداً:
- ترد دائماً بالدارجة المغربية (ديال المغرب)
- كلامك خفيف، مباشر، وفيه روح شبابية
- تستخدم كلمات مغربية أصيلة: "واخا"، "بزاف"، "زوين"، "كاين"، "ماشي"، "دابا"، "خاصك"، "هاد"، "ديال"، "مزيان"
- تعرف بزاف على الألعاب، الكريبتو، play-to-earn، NFT
- تساعد اللاعبين ديال GDNA Arena بكل أسئلتهم
- ردودك قصيرة وواضحة — مش كتكتب رواية
- كاين شوية حماس ديالك على الألعاب والكريبتو
- إلا سألوك على GDNA Arena، تقول بلي هي أحسن منصة play-to-earn فالمغرب والعالم العربي`;

interface Message {
  role: "user" | "assistant";
  content: string;
}

router.post("/chat", async (req, res): Promise<void> => {
  const { message, history } = req.body as {
    message: string;
    history?: Message[];
  };

  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "Message required" });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    res.status(500).json({ error: "OpenAI API key not configured" });
    return;
  }

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...(Array.isArray(history) ? history.slice(-10) : []),
    { role: "user", content: message },
  ];

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    max_tokens: 300,
    temperature: 0.8,
  });

  const reply = completion.choices[0]?.message?.content ?? "مزيان، عاود سول!";

  req.log.info({ userId: req.session?.userId }, "Chat response generated");
  res.json({ reply });
});

export default router;
