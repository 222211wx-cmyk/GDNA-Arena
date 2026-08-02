import http from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";
import { attachSignalingServer } from "./lib/signaling.js";
import { startHonorAlertJob } from "./jobs/honor-alert.js";
import { startWelcomeBroadcastJob, runWelcomeBroadcast } from "./jobs/welcome-broadcast.js";
import { startImperialDecreeJob, runImperialDecree } from "./jobs/imperial-decree.js";
import { ensureNeuralTables } from "./lib/neural-core.js";
import { startNeuralLearningJob } from "./jobs/neural-learning.js";
import { ensureGenomeTables } from "./lib/genome-engine.js";
import { startGenomeEvolutionJob } from "./jobs/genome-evolution.js";

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required but was not provided.");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

const SEED_LEGENDS = [
  {
    rank: 1, name: "Cristiano Ronaldo", domain: "sport", nationality: "Portuguese", score: 9820,
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8c/Cristiano_Ronaldo_2018.jpg/400px-Cristiano_Ronaldo_2018.jpg",
    peakYear: 2018,
    bio: {
      childhood: "Born in Funchal, Madeira on February 5, 1985, Cristiano grew up in a small house with three siblings. His father was a gardener, and money was scarce. Football was free — and it was his escape.",
      training: "At 12 he left home to join Sporting CP's academy in Lisbon. He trained while homesick, crying at night but waking at dawn to train again. At 16, a heart surgery nearly ended his career — he was back on the pitch within weeks.",
      breakthrough: "In 2003, Sir Alex Ferguson signed the 18-year-old for Manchester United. His debut electrified Old Trafford. Three Premier League titles and a Ballon d'Or at United announced the arrival of a new god.",
      stardom: "Nine Ballon d'Or trophies. Five Champions Leagues. The all-time international goals record. CR7 is not just the greatest of his era — he redefined what a human body can achieve through discipline alone."
    },
    videos: [
      { youtubeId: "dSio_PS8NMg", title: "Top 50 Goals — All Time" },
      { youtubeId: "ZrCUz2kbLaQ", title: "Cristiano vs Messi — The Eternal Rivalry" },
      { youtubeId: "mfM2bw7MvNs", title: "Champions League Final 2018" },
    ],
    stats: { clutch: 99, legacy: 98, style: 94, impact: 97, peak: 99 },
  },
  {
    rank: 2, name: "Lionel Messi", domain: "sport", nationality: "Argentine", score: 9750,
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b4/Lionel-Messi-Argentina-2022-FIFA-World-Cup_%28cropped%29.jpg/400px-Lionel-Messi-Argentina-2022-FIFA-World-Cup_%28cropped%29.jpg",
    peakYear: 2022,
    bio: {
      childhood: "Born June 24, 1987 in Rosario, Argentina. Leo was small, quieter than the rest, but on grass he saw the game differently. His growth hormone condition meant he'd need treatment — Barcelona saw the genius and paid for it.",
      training: "He moved to Spain at 13 to join La Masia. Shy, homesick, and barely speaking at meals — but when he touched the ball, every coach fell silent and watched.",
      breakthrough: "His first goal for Barcelona came on May 1, 2005 against Albacete. He chipped the ball over the goalkeeper with a naturalness that stunned the world. The rest is scripture.",
      stardom: "Eight Ballon d'Or trophies. A World Cup with Argentina in 2022 — the one trophy he needed. The most complete footballer ever to play the game. Messi didn't just play football. He composed it."
    },
    videos: [
      { youtubeId: "Lqe5k25v5Wo", title: "Messi — The Greatest Goals Ever" },
      { youtubeId: "PGbRi4e0Nf8", title: "Argentina World Cup 2022 — Full Journey" },
      { youtubeId: "EaZDCFP3MK0", title: "Messi 91 Goals in 2012 — Historic Year" },
    ],
    stats: { clutch: 97, legacy: 99, style: 99, impact: 98, peak: 99 },
  },
  {
    rank: 3, name: "Elon Musk", domain: "tech", nationality: "South African-American", score: 9680,
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/34/Elon_Musk_Royal_Society_%28cropped%29.jpg/400px-Elon_Musk_Royal_Society_%28cropped%29.jpg",
    peakYear: 2021,
    bio: {
      childhood: "Born June 28, 1971 in Pretoria, South Africa. A bookworm who finished the school library twice, then moved to encyclopedias. He was bullied brutally and retreated into science fiction and code.",
      training: "Self-taught coder by 12. Sold his first game, Blastar, for $500. Moved to Canada at 17 escaping apartheid-era South Africa, then to Penn. Dropped out of Stanford after two days to pursue his real mission.",
      breakthrough: "Zip2 sold for $307M. Then X.com became PayPal, sold for $1.5B. He put nearly everything into Tesla and SpaceX when both were on the brink of bankruptcy in 2008. Both survived. Everything changed.",
      stardom: "Tesla made electric cars cool. SpaceX made humans multi-planetary. The richest human in history. Whatever you think of him, Elon Musk compressed a century of technological progress into a decade."
    },
    videos: [
      { youtubeId: "tnBQmEqBCY0", title: "SpaceX — The Reusable Rocket Revolution" },
      { youtubeId: "t705r8ICkRw", title: "Elon Musk: How to Build the Future" },
      { youtubeId: "L-s_3b5fRd8", title: "Tesla's Journey from Startup to Empire" },
    ],
    stats: { clutch: 95, legacy: 92, style: 75, impact: 99, peak: 96 },
  },
  {
    rank: 4, name: "Beyoncé", domain: "music", nationality: "American", score: 9540,
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/17/Beyonce_at_The_London_Stadium_%28cropped%29.jpg/400px-Beyonce_at_The_London_Stadium_%28cropped%29.jpg",
    peakYear: 2016,
    bio: {
      childhood: "Born September 4, 1981 in Houston, Texas. Sang in church at 7, competed in talent shows at 8. Diagnosed as shy — on stage she became someone else entirely. Destiny's Child was forming in a living room.",
      training: "Years of choreography, vocal training, and performance discipline forged an artist with no rivals. She famously rehearses more than anyone. Perfection is her baseline.",
      breakthrough: "Destiny's Child broke globally in 1999. Her 2003 solo album Dangerously in Love announced that the next era of music had one undisputed ruler.",
      stardom: "33 Grammy Awards — the most of any artist. The Renaissance World Tour. Lemonade, a visual album that redefined the form. Beyoncé doesn't follow culture. She manufactures it."
    },
    videos: [
      { youtubeId: "2XY3AvVgDns", title: "Crazy in Love — The Iconic Debut" },
      { youtubeId: "04854XqcfBY", title: "Lemonade — Full Visual Album Highlights" },
      { youtubeId: "VBmMU_iwe6U", title: "Coachella 2018 — Historic Performance" },
    ],
    stats: { clutch: 98, legacy: 96, style: 99, impact: 97, peak: 99 },
  },
  {
    rank: 5, name: "LeBron James", domain: "sport", nationality: "American", score: 9410,
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cf/LeBron_James_crop2.jpg/400px-LeBron_James_crop2.jpg",
    peakYear: 2016,
    bio: {
      childhood: "Born December 30, 1984 in Akron, Ohio. Raised by a single mother. Moved 12 times before 13. Basketball was stability. He was on national magazine covers before he graduated high school.",
      training: "Straight from high school to the NBA as the #1 pick in 2003. He studied film obsessively, developed his IQ to match his physical dominance, and built a legacy greater than any single championship.",
      breakthrough: "2007 Eastern Conference Finals — LeBron scored 25 of his team's last 30 points against Detroit. The world stopped and paid attention. He was 22.",
      stardom: "4 NBA championships. 4 MVP awards. Brought the championship to Cleveland in 2016, erasing a 52-year drought. The most complete basketball player in NBA history. Also a billionaire. Also a film producer."
    },
    videos: [
      { youtubeId: "UkgCZ3e6DV0", title: "LeBron's 2016 Finals Game 7 Block" },
      { youtubeId: "0bL8NuwIvdM", title: "LeBron James — Career Highlights" },
      { youtubeId: "XbfF4q1TDAA", title: "The Decision and the Return to Cleveland" },
    ],
    stats: { clutch: 98, legacy: 97, style: 88, impact: 96, peak: 98 },
  },
  {
    rank: 6, name: "Taylor Swift", domain: "music", nationality: "American", score: 9320,
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b5/191125_Taylor_Swift_at_the_2019_American_Music_Awards_%28cropped%29.jpg/400px-191125_Taylor_Swift_at_the_2019_American_Music_Awards_%28cropped%29.jpg",
    peakYear: 2023,
    bio: {
      childhood: "Born December 13, 1989 in West Reading, Pennsylvania. Memorized every Broadway show. Got her first guitar at 12. Moved to Nashville at 14 after every label rejected her. One said yes.",
      training: "Wrote her first published song at 14. Produced her first album at 16. She watches every aspect of her craft — songwriting, production, choreography, business. Taylor Swift is a corporation that sings.",
      breakthrough: "2008's Fearless became the best-selling album of the year. Grammy for Album of the Year at age 20. Country music had never seen velocity like this.",
      stardom: "The Eras Tour made $1 billion — the highest-grossing concert tour of all time. She re-recorded her first six albums, owning her masters and teaching a generation what artistic sovereignty looks like. She is the industry."
    },
    videos: [
      { youtubeId: "nfWlot6h_JM", title: "Shake It Off — Global Phenomenon" },
      { youtubeId: "QcIy9NiNbmo", title: "Eras Tour Opening Night — Full Setlist" },
      { youtubeId: "e-ORhEE9VVg", title: "All Too Well (10 Minute Version)" },
    ],
    stats: { clutch: 97, legacy: 95, style: 98, impact: 98, peak: 99 },
  },
  {
    rank: 7, name: "Roger Federer", domain: "sport", nationality: "Swiss", score: 9180,
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/4/40/Federer_Indian_Wells_2012_3_%28cropped%29.jpg/400px-Federer_Indian_Wells_2012_3_%28cropped%29.jpg",
    peakYear: 2006,
    bio: {
      childhood: "Born August 8, 1981 in Basel, Switzerland. Played table tennis, basketball, and football before tennis consumed him. His movement on court was called 'the most beautiful in sports history' before he turned 20.",
      training: "Spent years at the Swiss national tennis center. Known for his calmness under pressure — a mental coach traveled with him for a decade. He would rewatch matches not for tactics, but for feeling.",
      breakthrough: "2001 Wimbledon — the 19-year-old beat Pete Sampras on Centre Court. Sampras wept. The world understood it had just witnessed a passing of the crown.",
      stardom: "20 Grand Slam titles. 6 consecutive US Opens. A grace on court that made his opponents feel they were losing to art rather than an opponent. Federer made tennis a religion for a billion people who never played."
    },
    videos: [
      { youtubeId: "iu9hpQ_OwkA", title: "Roger Federer — The Most Elegant Shots Ever" },
      { youtubeId: "Czdxv1CYDLI", title: "2017 Australian Open Final — The Comeback" },
      { youtubeId: "8tPnX9LCfAI", title: "Federer vs Nadal Wimbledon 2008 — Greatest Match" },
    ],
    stats: { clutch: 97, legacy: 98, style: 99, impact: 95, peak: 99 },
  },
  {
    rank: 8, name: "Steve Jobs", domain: "tech", nationality: "American", score: 9100,
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/d/dc/Steve_Jobs_Headshot_2010-CROP_%28cropped_2%29.jpg/400px-Steve_Jobs_Headshot_2010-CROP_%28cropped_2%29.jpg",
    peakYear: 2007,
    bio: {
      childhood: "Born February 24, 1955 in San Francisco. Adopted. Felt different from birth. Dropped out of Reed College after 6 months but audited calligraphy classes for 18 months — which later became the Mac's fonts.",
      training: "Built Apple in a garage with Steve Wozniak at 21. Got fired from his own company at 30. Instead of breaking, he built Pixar and NeXT. Apple bought NeXT — and got Jobs back.",
      breakthrough: "The 1984 Macintosh launch. The \"1984\" Super Bowl ad. A man stepping onto a stage saying 'We're here to put a dent in the universe.' Half the room thought he was crazy. The other half became disciples.",
      stardom: "The iMac. iPod. iPhone. iPad. iTunes. He changed five industries in ten years. When he died in 2011, the iPhone was four years old and had already rewired human civilization. He was right about everything that mattered."
    },
    videos: [
      { youtubeId: "VQKMoT-6XSg", title: "iPhone 2007 — The Launch That Changed Everything" },
      { youtubeId: "UF8uR6Z6KLc", title: "Stanford Commencement — Stay Hungry Stay Foolish" },
      { youtubeId: "D1R-jKKp3NA", title: "Steve Jobs — The Lost Interview" },
    ],
    stats: { clutch: 95, legacy: 99, style: 96, impact: 99, peak: 97 },
  },
  {
    rank: 9, name: "Serena Williams", domain: "sport", nationality: "American", score: 8960,
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/5/5b/Serena_Williams_at_The_Championships_Wimbledon_2013_-_July_4%2C_2013_%28cropped%29.jpg/400px-Serena_Williams_at_The_Championships_Wimbledon_2013_-_July_4%2C_2013_%28cropped%29.jpg",
    peakYear: 2015,
    bio: {
      childhood: "Born September 26, 1981 in Saginaw, Michigan. Her father Richard Williams wrote a plan for his daughters to be tennis champions before they were born. They were raised on Compton public courts with broken nets.",
      training: "Practiced at Compton courts where gangs sometimes watched. She absorbed violence as ambient noise and used it as fuel. Venus paved the road; Serena turned it into a highway.",
      breakthrough: "1999 US Open — Serena wins her first Grand Slam at 17. She walks off court and onto a throne she would occupy for two and a half decades.",
      stardom: "23 Grand Slam singles titles — more than any other man or woman in the Open Era. Won the 2017 Australian Open while eight weeks pregnant. Serena Williams is the most dominant athlete in the history of individual sport."
    },
    videos: [
      { youtubeId: "cbTRDQSmLEg", title: "Serena Williams — 23 Grand Slams in 5 Minutes" },
      { youtubeId: "8ZR8RFiMpgw", title: "Best Serena Shots Of All Time" },
      { youtubeId: "fYxPxZ4qZAY", title: "Serena Williams — A Champion's Farewell" },
    ],
    stats: { clutch: 99, legacy: 98, style: 90, impact: 96, peak: 99 },
  },
  {
    rank: 10, name: "Muhammad Ali", domain: "sport", nationality: "American", score: 8890,
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/89/Muhammad_Ali_NYWTS.jpg/400px-Muhammad_Ali_NYWTS.jpg",
    peakYear: 1974,
    bio: {
      childhood: "Born Cassius Clay on January 17, 1942 in Louisville, Kentucky. At 12, his bicycle was stolen. He told a police officer he wanted to beat up whoever stole it. The officer taught him to box instead. History pivoted.",
      training: "He trained at a gym where he was the last to leave every night. His trainer Angelo Dundee called him 'the hardest working man I ever saw.' He ran five miles at 5am every morning for twenty years.",
      breakthrough: "February 25, 1964 — Cassius Clay defeats Sonny Liston, the 'unbeatable' heavyweight champion. He announced his name was now Muhammad Ali. The world was confused. History was being written.",
      stardom: "The Rumble in the Jungle. The Thrilla in Manila. Three-time heavyweight champion of the world. Refused the Vietnam draft, losing 3.5 prime years, standing on moral principle at the peak of his career. The Greatest is not a nickname. It is a verdict."
    },
    videos: [
      { youtubeId: "Xfx3aN2qS4A", title: "The Rumble in the Jungle — 1974" },
      { youtubeId: "HqpZiOCBqeU", title: "Muhammad Ali — The Greatest Moments" },
      { youtubeId: "Moo7rF3mhyQ", title: "Ali vs Frazier — Thrilla in Manila" },
    ],
    stats: { clutch: 99, legacy: 99, style: 98, impact: 99, peak: 98 },
  },
];

async function ensureTables() {
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "gs_figures" (
        "id" serial PRIMARY KEY,
        "name" text NOT NULL,
        "domain" text NOT NULL,
        "nationality" text DEFAULT '' NOT NULL,
        "image_url" text,
        "votes" integer DEFAULT 0 NOT NULL,
        "bio" text DEFAULT '' NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS "legends" (
        "id" serial PRIMARY KEY,
        "name" text NOT NULL,
        "domain" text NOT NULL,
        "nationality" text DEFAULT '' NOT NULL,
        "rank" integer DEFAULT 1 NOT NULL,
        "score" integer DEFAULT 0 NOT NULL,
        "image_url" text,
        "peak_year" integer,
        "bio" jsonb,
        "videos" jsonb DEFAULT '[]',
        "stats" jsonb,
        "is_active" boolean DEFAULT true NOT NULL,
        "last_updated" timestamp DEFAULT now() NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS "legend_debates" (
        "id" serial PRIMARY KEY,
        "legend_id" integer NOT NULL,
        "user_id" integer,
        "username" text DEFAULT 'Anonymous' NOT NULL,
        "message" text NOT NULL,
        "likes" integer DEFAULT 0 NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS "legend_watches" (
        "id" serial PRIMARY KEY,
        "legend_id" integer NOT NULL,
        "user_id" integer,
        "voter_ip" text NOT NULL,
        "video_id" text NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
      )
    `);

    // Pulse tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "pulse_posts" (
        "id" serial PRIMARY KEY,
        "user_id" integer,
        "username" text DEFAULT 'Anonymous' NOT NULL,
        "avatar" text,
        "content" text NOT NULL,
        "domain" text DEFAULT 'general' NOT NULL,
        "type" text DEFAULT 'post' NOT NULL,
        "likes" integer DEFAULT 0 NOT NULL,
        "is_visible" boolean DEFAULT true NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "pulse_events" (
        "id" serial PRIMARY KEY,
        "title" text NOT NULL,
        "title_ar" text,
        "domain" text NOT NULL,
        "location" text NOT NULL,
        "country" text DEFAULT '' NOT NULL,
        "event_date" text NOT NULL,
        "is_live" boolean DEFAULT false NOT NULL,
        "icon" text DEFAULT '🌍' NOT NULL,
        "color" text DEFAULT '#C9A84C' NOT NULL,
        "impact_score" integer DEFAULT 50 NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "pulse_post_likes" (
        "id" serial PRIMARY KEY,
        "post_id" integer NOT NULL,
        "voter_ip" text NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
      )
    `);

    // Seed events if empty
    const { rows: evRows } = await pool.query(`SELECT COUNT(*) as count FROM "pulse_events"`);
    if (parseInt(evRows[0].count) === 0) {
      const EVENTS = [
        { title:"FIFA World Cup 2026", titleAr:"كأس العالم 2026", domain:"sport",    location:"USA / Canada / Mexico", country:"🇺🇸", eventDate:"2026-06-11", isLive:true,  icon:"⚽", color:"#22d3ee", impact:99 },
        { title:"UEFA Champions League Final", titleAr:"نهائي دوري أبطال أوروبا", domain:"sport", location:"Munich, Germany", country:"🇩🇪", eventDate:"2026-05-30", isLive:true, icon:"🏆", color:"#FFD700", impact:95 },
        { title:"Cannes Film Festival", titleAr:"مهرجان كان السينمائي", domain:"cinema", location:"Cannes, France", country:"🇫🇷", eventDate:"2026-05-13", isLive:false, icon:"🎬", color:"#fb923c", impact:88 },
        { title:"Grammy Awards 2026", titleAr:"جوائز غرامي 2026", domain:"music", location:"Los Angeles, USA", country:"🇺🇸", eventDate:"2026-02-05", isLive:false, icon:"🎵", color:"#f472b6", impact:90 },
        { title:"CES 2027 — Tech Innovation", titleAr:"معرض الإلكترونيات الاستهلاكية", domain:"tech", location:"Las Vegas, USA", country:"🇺🇸", eventDate:"2027-01-08", isLive:false, icon:"🔮", color:"#a78bfa", impact:85 },
        { title:"Davos World Economic Forum", titleAr:"منتدى دافوس الاقتصادي", domain:"business", location:"Davos, Switzerland", country:"🇨🇭", eventDate:"2027-01-19", isLive:false, icon:"💎", color:"#4ade80", impact:87 },
        { title:"Ballon d'Or Ceremony", titleAr:"حفل الكرة الذهبية", domain:"sport", location:"Paris, France", country:"🇫🇷", eventDate:"2026-10-27", isLive:false, icon:"🥇", color:"#FFD700", impact:92 },
        { title:"Nobel Prize Week", titleAr:"أسبوع جائزة نوبل", domain:"tech", location:"Stockholm, Sweden", country:"🇸🇪", eventDate:"2026-10-05", isLive:false, icon:"🔬", color:"#a78bfa", impact:80 },
        { title:"Olympics Los Angeles 2028", titleAr:"أولمبياد لوس أنجلوس 2028", domain:"sport", location:"Los Angeles, USA", country:"🇺🇸", eventDate:"2028-07-21", isLive:false, icon:"🏅", color:"#22d3ee", impact:100 },
        { title:"AFCON 2025 Final", titleAr:"نهائي كأس أمم أفريقيا", domain:"sport", location:"Morocco", country:"🇲🇦", eventDate:"2025-02-09", isLive:false, icon:"🌍", color:"#4ade80", impact:82 },
        { title:"Oscars Academy Awards", titleAr:"جوائز أوسكار", domain:"cinema", location:"Hollywood, USA", country:"🇺🇸", eventDate:"2026-03-29", isLive:false, icon:"🎭", color:"#fb923c", impact:89 },
        { title:"Coachella Music Festival", titleAr:"مهرجان كواتشيلا", domain:"music", location:"Indio, California", country:"🇺🇸", eventDate:"2026-04-10", isLive:false, icon:"🎸", color:"#f472b6", impact:83 },
        { title:"Arab Cup 2026", titleAr:"كأس العرب 2026", domain:"sport", location:"Saudi Arabia", country:"🇸🇦", eventDate:"2026-12-01", isLive:false, icon:"⭐", color:"#FFD700", impact:78 },
        { title:"Tech Dubai Summit", titleAr:"قمة دبي للتقنية", domain:"tech", location:"Dubai, UAE", country:"🇦🇪", eventDate:"2026-11-15", isLive:false, icon:"🚀", color:"#a78bfa", impact:75 },
        { title:"World Athletics Championship", titleAr:"بطولة العالم لألعاب القوى", domain:"sport", location:"Tokyo, Japan", country:"🇯🇵", eventDate:"2025-09-13", isLive:false, icon:"🏃", color:"#22d3ee", impact:80 },
      ];
      for (const ev of EVENTS) {
        await pool.query(
          `INSERT INTO "pulse_events" (title, title_ar, domain, location, country, event_date, is_live, icon, color, impact_score)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [ev.title, ev.titleAr, ev.domain, ev.location, ev.country, ev.eventDate, ev.isLive, ev.icon, ev.color, ev.impact]
        );
      }
      // Seed starter posts
      const STARTER_POSTS = [
        { username:"ImperialOracle", content:"The empire rises — every vote, every game, every legend adds a brick to this digital civilization. 🏛️", domain:"general", type:"vision" },
        { username:"SportsTribunal", content:"FIFA World Cup 2026 is upon us — the ultimate test of who belongs in the TOP 10. ⚽🔥", domain:"sport", type:"tribute" },
        { username:"TechProphet", content:"AI is not the future. AI is now. GDNA Arena runs on neural intelligence — built for the age of machine wisdom. 🔮", domain:"tech", type:"vision" },
        { username:"MusicSoul", content:"Beyoncé's Renaissance Tour broke a billion dollars. The empire of sound has spoken. 🎵👑", domain:"music", type:"tribute" },
        { username:"NeuralEngine", content:"Welcome to EMPIRE PULSE — where every citizen speaks, every event matters, and every voice builds the future. 🌍⚡", domain:"general", type:"post" },
      ];
      for (const p of STARTER_POSTS) {
        await pool.query(
          `INSERT INTO "pulse_posts" (username, content, domain, type, likes) VALUES ($1,$2,$3,$4,$5)`,
          [p.username, p.content, p.domain, p.type, Math.floor(Math.random()*30)+5]
        );
      }
      console.log("[PULSE] Seeded 15 events + starter posts");
    }

    // Legend Stories + Arena Events tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "legend_stories" (
        "id" serial PRIMARY KEY,
        "legend_id" integer NOT NULL,
        "user_id" integer,
        "username" text DEFAULT 'Anonymous' NOT NULL,
        "content" text NOT NULL,
        "media_url" text,
        "type" text DEFAULT 'text' NOT NULL,
        "likes" integer DEFAULT 0 NOT NULL,
        "expires_at" timestamp NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "legend_arena_events" (
        "id" serial PRIMARY KEY,
        "legend_id" integer,
        "domain" text NOT NULL,
        "title" text NOT NULL,
        "speaker" text,
        "event_type" text DEFAULT 'lecture' NOT NULL,
        "youtube_id" text,
        "external_url" text,
        "event_date" text NOT NULL,
        "is_live" boolean DEFAULT false NOT NULL,
        "icon" text DEFAULT '🎓' NOT NULL,
        "coins_reward" integer DEFAULT 50 NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
      )
    `);

    // Seed arena events if empty
    const { rows: arenaRows } = await pool.query(`SELECT COUNT(*) as count FROM "legend_arena_events"`);
    if (parseInt(arenaRows[0].count) === 0) {
      const ARENA_EVENTS = [
        // Sport
        { domain:"sport",    title:"The Science of Peak Athletic Performance",   speaker:"Dr. Andrew Huberman", eventType:"lecture",    youtubeId:"SwQhKFMxmDY", eventDate:"2026-08-05", isLive:false, icon:"⚽" },
        { domain:"sport",    title:"Champions Mindset — How Legends Are Made",   speaker:"Simon Sinek",          eventType:"lecture",    youtubeId:"qp0HIF3SfI4", eventDate:"2026-08-12", isLive:true,  icon:"🏆" },
        { domain:"sport",    title:"Global Sports Summit 2026 — Future of Sport",speaker:"FIFA / IOC",            eventType:"summit",     eventDate:"2026-09-01", isLive:false, icon:"🌍" },
        // Tech
        { domain:"tech",     title:"The Intelligence Revolution — AI & Human Potential", speaker:"Sam Altman",   eventType:"conference", youtubeId:"CthzFJcH_7g", eventDate:"2026-08-20", isLive:false, icon:"🔮" },
        { domain:"tech",     title:"TED: How AI Will Change Everything",          speaker:"Demis Hassabis",       eventType:"lecture",    youtubeId:"yhncB5BdSV8", eventDate:"2026-07-30", isLive:true,  icon:"⚡" },
        { domain:"tech",     title:"Web3 & The Digital Empire",                   speaker:"Vitalik Buterin",      eventType:"debate",     eventDate:"2026-09-15", isLive:false, icon:"💎" },
        // Music
        { domain:"music",    title:"The Art of Musical Genius — A Masterclass",  speaker:"Quincy Jones",         eventType:"lecture",    youtubeId:"UF8uR6Z6KLc", eventDate:"2026-08-08", isLive:false, icon:"🎵" },
        { domain:"music",    title:"Grammy MasterClass: The Making of a Legend", speaker:"Panel of Legends",     eventType:"conference", eventDate:"2026-09-20", isLive:false, icon:"🎸" },
        // Business
        { domain:"business", title:"Principles of Empire Building",               speaker:"Ray Dalio",            eventType:"lecture",    youtubeId:"PHe0bXAIuk0", eventDate:"2026-08-15", isLive:false, icon:"💰" },
        { domain:"business", title:"Davos Special: Global Economy 2026",          speaker:"World Economic Forum", eventType:"summit",     eventDate:"2026-09-05", isLive:false, icon:"🌐" },
        // Cinema
        { domain:"cinema",   title:"Cannes Masterclass: The Language of Cinema", speaker:"Christopher Nolan",    eventType:"lecture",    eventDate:"2026-08-25", isLive:false, icon:"🎬" },
        { domain:"cinema",   title:"Storytelling in the Age of AI",               speaker:"Spike Lee",            eventType:"debate",     eventDate:"2026-09-10", isLive:false, icon:"🎭" },
      ];
      for (const ev of ARENA_EVENTS) {
        await pool.query(
          `INSERT INTO "legend_arena_events" (domain, title, speaker, event_type, youtube_id, event_date, is_live, icon, coins_reward)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [ev.domain, ev.title, ev.speaker ?? null, ev.eventType, (ev as { youtubeId?: string }).youtubeId ?? null, ev.eventDate, ev.isLive, ev.icon, 50]
        );
      }
      console.log("[ARENA] Seeded 12 arena events");
    }

    // Seed legends if empty
    const { rows } = await pool.query(`SELECT COUNT(*) as count FROM "legends"`);
    if (parseInt(rows[0].count) === 0) {
      for (const l of SEED_LEGENDS) {
        await pool.query(
          `INSERT INTO "legends" (name, domain, nationality, rank, score, image_url, peak_year, bio, videos, stats)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [l.name, l.domain, l.nationality, l.rank, l.score, l.imageUrl, l.peakYear,
           JSON.stringify(l.bio), JSON.stringify(l.videos), JSON.stringify(l.stats)]
        );
      }
      // Seed a couple starter debates
      const { rows: legRows } = await pool.query(`SELECT id, name FROM "legends" ORDER BY rank LIMIT 3`);
      for (const leg of legRows) {
        const starters = [
          `${leg.name} deserves #1 because nobody has dominated their field with this consistency for this long.`,
          `The numbers don't lie — look at the peak year performance. Generational.`,
          `What separates a legend from a champion is carrying others. ${leg.name} did exactly that.`,
        ];
        for (const msg of starters) {
          await pool.query(
            `INSERT INTO "legend_debates" (legend_id, username, message, likes) VALUES ($1,$2,$3,$4)`,
            [leg.id, "NeuralEngine", msg, Math.floor(Math.random() * 40) + 5]
          );
        }
      }
      console.log("[NEURAL] Seeded 10 legends + debates");
    }

    // ── Learn Hub tables ───────────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "learn_courses" (
        "id" serial PRIMARY KEY,
        "title" text NOT NULL,
        "title_ar" text,
        "domain" text NOT NULL,
        "instructor" text NOT NULL,
        "description" text NOT NULL,
        "youtube_id" text,
        "duration" integer NOT NULL DEFAULT 10,
        "xp_reward" integer NOT NULL DEFAULT 20,
        "level" text NOT NULL DEFAULT 'beginner',
        "icon" text NOT NULL DEFAULT '🎓',
        "total_students" integer NOT NULL DEFAULT 0,
        "is_live" boolean NOT NULL DEFAULT false,
        "created_at" timestamp DEFAULT now() NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "learn_progress" (
        "id" serial PRIMARY KEY,
        "user_id" integer NOT NULL,
        "course_id" integer NOT NULL,
        "completed_at" timestamp DEFAULT now() NOT NULL
      )
    `);

    // Seed courses if empty
    const { rows: lcRows } = await pool.query(`SELECT COUNT(*) as count FROM "learn_courses"`);
    if (parseInt(lcRows[0].count) === 0) {
      const COURSES = [
        // SPORT
        { title:"The Science of Peak Performance", titleAr:"علم الأداء الذروة", domain:"sport", instructor:"Dr. Andrew Huberman", description:"Neuroscience-backed protocols for athletic excellence — sleep, sunlight, and focus training.", youtubeId:"SwQhKFMxmDY", duration:45, xpReward:30, level:"intermediate", icon:"⚡", isLive:true },
        { title:"Champions Mindset — How Legends Think", titleAr:"عقلية الأبطال", domain:"sport", instructor:"Simon Sinek", description:"The mental frameworks shared by every world champion — from Ronaldo to Michael Jordan.", youtubeId:"qp0HIF3SfI4", duration:20, xpReward:20, level:"beginner", icon:"🏆", isLive:false },
        { title:"Tactical Football Mastery", titleAr:"إتقان التكتيك", domain:"sport", instructor:"Pep Guardiola (lecture)", description:"Understanding positional play, pressing traps, and space creation in modern football.", youtubeId:"UF8uR6Z6KLc", duration:35, xpReward:25, level:"advanced", icon:"⚽", isLive:false },
        // SCIENCE / TECH
        { title:"The Intelligence Revolution", titleAr:"ثورة الذكاء الاصطناعي", domain:"tech", instructor:"Sam Altman", description:"How AI will reshape civilization — from AGI to the jobs of 2030.", youtubeId:"CthzFJcH_7g", duration:30, xpReward:25, level:"beginner", icon:"🔮", isLive:true },
        { title:"TED: How AI Learns", titleAr:"كيف يتعلم الذكاء الاصطناعي", domain:"tech", instructor:"Demis Hassabis", description:"DeepMind founder explains neural networks, AlphaGo, and the path to general intelligence.", youtubeId:"yhncB5BdSV8", duration:18, xpReward:20, level:"beginner", icon:"🧠", isLive:false },
        { title:"Quantum Computing Explained", titleAr:"الحوسبة الكمية", domain:"science", instructor:"MIT OpenCourseWare", description:"From qubits to quantum supremacy — a beginner-friendly journey into tomorrow's computing.", youtubeId:"JhHMJCUmq28", duration:25, xpReward:25, level:"intermediate", icon:"🔬", isLive:false },
        // BUSINESS
        { title:"Principles of Empire Building", titleAr:"مبادئ بناء الإمبراطورية", domain:"business", instructor:"Ray Dalio", description:"How the world's most successful hedge fund operator thinks about systems, failure, and success.", youtubeId:"PHe0bXAIuk0", duration:40, xpReward:30, level:"intermediate", icon:"💰", isLive:false },
        { title:"Start With Why — Leadership Mastery", titleAr:"ابدأ بالسبب", domain:"business", instructor:"Simon Sinek", description:"The Golden Circle framework — why great leaders inspire action while others don't.", youtubeId:"u4ZoJKF_VuA", duration:18, xpReward:20, level:"beginner", icon:"💡", isLive:false },
        // ART / MUSIC
        { title:"The Art of Storytelling", titleAr:"فن رواية القصص", domain:"art", instructor:"Pixar Storytellers", description:"How Pixar creates emotionally resonant stories — the same principles apply everywhere.", youtubeId:"E_CVll9ZPiY", duration:22, xpReward:20, level:"beginner", icon:"🎨", isLive:false },
        { title:"Music Theory for Legends", titleAr:"نظرية الموسيقى للمبتدئين", domain:"music", instructor:"Berklee Online", description:"Chords, scales, rhythm, and the fundamentals that separate great musicians from average ones.", youtubeId:"rgaTLrZGlk0", duration:35, xpReward:25, level:"beginner", icon:"🎵", isLive:false },
        // EDUCATION
        { title:"How to Learn Anything Faster", titleAr:"كيف تتعلم بشكل أسرع", domain:"education", instructor:"Barbara Oakley", description:"The neuroscience of learning — spaced repetition, focused vs diffuse thinking, chunking.", youtubeId:"O96fWhWccew", duration:20, xpReward:20, level:"beginner", icon:"📚", isLive:false },
        { title:"Critical Thinking Masterclass", titleAr:"التفكير النقدي", domain:"education", instructor:"Dr. Jordan Peterson", description:"How to structure arguments, detect fallacies, and think with genuine intellectual clarity.", youtubeId:"x0vUsxhMczI", duration:55, xpReward:35, level:"advanced", icon:"🧩", isLive:true },
      ];
      for (const c of COURSES) {
        await pool.query(
          `INSERT INTO "learn_courses" (title, title_ar, domain, instructor, description, youtube_id, duration, xp_reward, level, icon, is_live)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [c.title, c.titleAr, c.domain, c.instructor, c.description, c.youtubeId ?? null, c.duration, c.xpReward, c.level, c.icon, c.isLive]
        );
      }
      console.log("[LEARN] Seeded 12 courses");
    }

    // ── Platform Stories + Story Likes tables ─────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "platform_stories" (
        "id" serial PRIMARY KEY,
        "user_id" integer,
        "username" text NOT NULL DEFAULT 'Anonymous',
        "content" text NOT NULL,
        "audio_url" text,
        "image_url" text,
        "type" text NOT NULL DEFAULT 'text',
        "domain" text NOT NULL DEFAULT 'general',
        "likes" integer NOT NULL DEFAULT 0,
        "is_visible" boolean NOT NULL DEFAULT true,
        "expires_at" timestamp NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "story_likes" (
        "id" serial PRIMARY KEY,
        "story_id" integer NOT NULL,
        "voter_ip" text NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
      )
    `);

    // Seed starter stories if empty
    const { rows: stRows } = await pool.query(`SELECT COUNT(*) as count FROM "platform_stories"`);
    if (parseInt(stRows[0].count) === 0) {
      const exp24 = new Date(Date.now() + 24 * 3600 * 1000);
      const STORIES = [
        { username:"ImperialOracle", content:"EMPIRE ETERNAL is not just a platform — it is a civilization being written in real-time by every citizen who dares to speak. 🏛️", domain:"education", type:"text" },
        { username:"SportsTribunal", content:"Just watched Ronaldo's goal against Juventus again for the 100th time. The bicycle kick that stopped time. Sport is the purest form of human excellence.", domain:"sport", type:"text" },
        { username:"TechProphet", content:"AI doesn't replace human intelligence — it amplifies it. The question isn't whether to use AI, it's whether you understand it well enough to wield it. 🔮", domain:"tech", type:"text" },
        { username:"MusicSoul", content:"Music theory and mathematics share the same DNA. Every chord progression is an equation. Every rhythm is a fractal. The empire of sound is built on logic. 🎵", domain:"music", type:"text" },
        { username:"NeuralEngine", content:"The real competition isn't with others. It's with the version of yourself that almost gave up. Champions are forged in invisible moments. ⚡", domain:"education", type:"text" },
      ];
      for (const s of STORIES) {
        await pool.query(
          `INSERT INTO "platform_stories" (username, content, domain, type, expires_at) VALUES ($1,$2,$3,$4,$5)`,
          [s.username, s.content, s.domain, s.type, exp24]
        );
      }
      console.log("[STORIES] Seeded 5 starter stories");
    }

    // ── Messaging tables ──────────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "dm_rooms" (
        "id" serial PRIMARY KEY, "name" text, "type" text NOT NULL DEFAULT 'direct',
        "icon" text DEFAULT '💬', "created_by" integer, "created_at" timestamp DEFAULT now() NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "dm_room_members" (
        "id" serial PRIMARY KEY, "room_id" integer NOT NULL, "user_id" integer NOT NULL,
        "username" text NOT NULL, "joined_at" timestamp DEFAULT now() NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "dm_messages" (
        "id" serial PRIMARY KEY, "room_id" integer NOT NULL, "user_id" integer,
        "username" text NOT NULL DEFAULT 'Anonymous', "content" text,
        "audio_url" text, "video_url" text, "type" text NOT NULL DEFAULT 'text',
        "is_read" boolean NOT NULL DEFAULT false, "created_at" timestamp DEFAULT now() NOT NULL
      )
    `);

    // ── Notifications table ───────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "notifications" (
        "id" serial PRIMARY KEY, "user_id" integer NOT NULL,
        "type" text NOT NULL, "title" text NOT NULL, "body" text NOT NULL,
        "icon" text NOT NULL DEFAULT '⚡', "is_read" boolean NOT NULL DEFAULT false,
        "link_path" text, "created_at" timestamp DEFAULT now() NOT NULL
      )
    `);

    // ── Celebrations tables ───────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "celebrations" (
        "id" serial PRIMARY KEY, "title" text NOT NULL, "title_ar" text,
        "category" text NOT NULL, "description" text NOT NULL,
        "date" text NOT NULL, "end_date" text, "icon" text NOT NULL DEFAULT '🎉',
        "color" text NOT NULL DEFAULT '#22c55e', "is_live" boolean NOT NULL DEFAULT false,
        "coins_reward" integer NOT NULL DEFAULT 50,
        "top_contributor_coins" integer NOT NULL DEFAULT 500,
        "created_at" timestamp DEFAULT now() NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "celebration_entries" (
        "id" serial PRIMARY KEY, "celebration_id" integer NOT NULL,
        "user_id" integer, "username" text NOT NULL DEFAULT 'Anonymous',
        "content" text NOT NULL, "media_url" text,
        "entry_type" text NOT NULL DEFAULT 'text', "likes" integer NOT NULL DEFAULT 0,
        "is_winner" boolean NOT NULL DEFAULT false,
        "has_imperial_laurel" boolean NOT NULL DEFAULT false,
        "created_at" timestamp DEFAULT now() NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "celebration_likes" (
        "id" serial PRIMARY KEY, "entry_id" integer NOT NULL,
        "voter_ip" text NOT NULL, "created_at" timestamp DEFAULT now() NOT NULL
      )
    `);

    // Seed celebrations if empty
    const { rows: celRows } = await pool.query(`SELECT COUNT(*) as count FROM "celebrations"`);
    if (parseInt(celRows[0].count) === 0) {
      const CELS = [
        { title:"FIFA World Cup 2026 — The Grand Finale",   titleAr:"نهائي كأس العالم 2026",       category:"sport",   description:"The biggest sporting event on Earth. 48 nations, one champion. Share your art, analysis, and tributes.", date:"2026-07-19", isLive:true,  icon:"⚽", color:"#22d3ee", coins:50, top:500 },
        { title:"Champions League Final Celebration",       titleAr:"نهائي أبطال أوروبا",          category:"sport",   description:"The pinnacle of club football. Where legends are forged and empires fall.", date:"2026-05-30", isLive:true,  icon:"🏆", color:"#FFD700", coins:50, top:500 },
        { title:"Nobel Prize Week 2026",                    titleAr:"أسبوع جائزة نوبل 2026",       category:"science", description:"Celebrate the greatest scientific and intellectual achievements of humanity.", date:"2026-10-05", isLive:false, icon:"🔬", color:"#a78bfa", coins:50, top:500 },
        { title:"Eid Al-Adha 2026 — Global Celebration",   titleAr:"عيد الأضحى 1447",             category:"holiday", description:"The Empire unites across cultures — share your traditions, art, and celebrations from around the world.", date:"2026-06-07", isLive:false, icon:"🌙", color:"#4ade80", coins:30, top:300 },
        { title:"International Day of Science & Education", titleAr:"يوم العلم والتعليم الدولي",   category:"science", description:"Celebrate the institutions, teachers, and discoveries that drive human progress.", date:"2026-11-10", isLive:false, icon:"📚", color:"#38bdf8", coins:40, top:400 },
        { title:"Cannes Palme d'Or Ceremony 2026",         titleAr:"جائزة السعفة الذهبية 2026",   category:"art",     description:"Cinema's highest honor. Debate, analyze, and celebrate the art of storytelling.", date:"2026-05-24", isLive:false, icon:"🎬", color:"#fb923c", coins:40, top:400 },
        { title:"Ballon d'Or Gala 2026",                   titleAr:"حفل الكرة الذهبية 2026",      category:"sport",   description:"Who deserves the greatest individual honor in football? Share your verdict, art, and tribute.", date:"2026-10-27", isLive:false, icon:"🥇", color:"#FFD700", coins:50, top:500 },
        { title:"Olympics Los Angeles 2028 — Countdown",  titleAr:"العد التنازلي للأولمبياد 2028",category:"sport",   description:"2 years to the greatest sporting celebration. Predict your champions, share your stories.", date:"2026-07-21", isLive:false, icon:"🏅", color:"#22d3ee", coins:30, top:300 },
      ];
      for (const c of CELS) {
        await pool.query(
          `INSERT INTO "celebrations" (title, title_ar, category, description, date, is_live, icon, color, coins_reward, top_contributor_coins)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [c.title, c.titleAr, c.category, c.description, c.date, c.isLive, c.icon, c.color, c.coins, c.top]
        );
      }
      // Seed a few starter entries for the live celebration
      const { rows: liveRow } = await pool.query(`SELECT id, title FROM "celebrations" WHERE is_live = true LIMIT 1`);
      if (liveRow[0]) {
        const ENTRIES = [
          { username:"ImperialOracle",  content:"The World Cup is the greatest test of civilization — not just football, but unity across 48 nations. This is what the Empire celebrates.", type:"text" },
          { username:"SportsTribunal",  content:"Argentina 2022 was poetry. But 2026 with 48 teams changes everything. The drama will be unprecedented. Who becomes legend?", type:"text" },
          { username:"TechProphet",     content:"AI-assisted refereeing, real-time biomechanics, and neural analytics — the 2026 World Cup is the first truly scientific tournament.", type:"idea" },
        ];
        for (const e of ENTRIES) {
          await pool.query(
            `INSERT INTO "celebration_entries" (celebration_id, username, content, entry_type, likes) VALUES ($1,$2,$3,$4,$5)`,
            [liveRow[0].id, e.username, e.content, e.type, Math.floor(Math.random()*20)+5]
          );
        }
      }
      console.log("[CELEBRATIONS] Seeded 8 celebrations");
    }

    // ── Citizen Honor tables ──────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "citizen_honor" (
        "id" serial PRIMARY KEY,
        "giver_id" integer NOT NULL,
        "receiver_id" integer NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        UNIQUE("giver_id","receiver_id")
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "citizen_violations" (
        "id" serial PRIMARY KEY,
        "user_id" integer NOT NULL,
        "reason" text NOT NULL,
        "severity" text NOT NULL DEFAULT 'minor',
        "is_muted" boolean NOT NULL DEFAULT false,
        "muted_until" timestamp,
        "created_at" timestamp DEFAULT now() NOT NULL
      )
    `);
    // honor_count column on users table (if not already present)
    // Social Hub tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "post_comments" (
        "id" serial PRIMARY KEY,
        "post_id" integer NOT NULL,
        "user_id" integer,
        "username" text NOT NULL DEFAULT 'Anonymous',
        "content" text NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "user_follows" (
        "id" serial PRIMARY KEY,
        "follower_id" integer NOT NULL,
        "following_id" integer NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        UNIQUE("follower_id","following_id")
      )
    `);
    await pool.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "honor_count" integer NOT NULL DEFAULT 0`);
    await pool.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_muted" boolean NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "honor_title" text NOT NULL DEFAULT 'Citizen'`);
    await pool.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_trending" boolean NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "honor_alert_sent" boolean NOT NULL DEFAULT false`);
    console.log("[HONOR] Citizen Honor System tables ready");

    // Seed starter group rooms if empty
    const { rows: grpRows } = await pool.query(`SELECT COUNT(*) as count FROM "dm_rooms" WHERE type='group'`);
    if (parseInt(grpRows[0].count) === 0) {
      const GROUPS = [
        { name:"🌍 Global Citizens Lounge",      icon:"🌍" },
        { name:"⚽ Sport Legends Discussion",     icon:"⚽" },
        { name:"🔮 Tech & Science Forum",         icon:"🔮" },
        { name:"🎵 Music & Art Collective",       icon:"🎵" },
        { name:"💰 Business & Innovation Lab",    icon:"💰" },
      ];
      for (const g of GROUPS) {
        await pool.query(`INSERT INTO "dm_rooms" (name, type, icon) VALUES ($1,'group',$2)`, [g.name, g.icon]);
      }
      console.log("[MESSENGER] Seeded 5 group rooms");
    }

    // ── Press / الصحافة العالمية tables ────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "press_posts" (
        "id"         serial PRIMARY KEY,
        "type"       text NOT NULL DEFAULT 'article',
        "title"      text,
        "content"    text NOT NULL,
        "video_url"  text,
        "image_url"  text,
        "author"     text NOT NULL DEFAULT 'صحفي',
        "likes"      integer NOT NULL DEFAULT 0,
        "is_visible" boolean NOT NULL DEFAULT true,
        "created_at" timestamp DEFAULT now() NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "press_post_likes" (
        "id"         serial PRIMARY KEY,
        "post_id"    integer NOT NULL,
        "voter_ip"   text NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "press_comments" (
        "id"         serial PRIMARY KEY,
        "post_id"    integer NOT NULL,
        "author"     text NOT NULL DEFAULT 'مواطن',
        "content"    text NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "press_polls" (
        "id"         serial PRIMARY KEY,
        "question"   text NOT NULL,
        "option_a"   text NOT NULL,
        "option_b"   text NOT NULL,
        "option_c"   text,
        "option_d"   text,
        "votes_a"    integer NOT NULL DEFAULT 0,
        "votes_b"    integer NOT NULL DEFAULT 0,
        "votes_c"    integer NOT NULL DEFAULT 0,
        "votes_d"    integer NOT NULL DEFAULT 0,
        "created_at" timestamp DEFAULT now() NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "press_poll_votes" (
        "id"            serial PRIMARY KEY,
        "poll_id"       integer NOT NULL,
        "option_chosen" text NOT NULL,
        "voter_ip"      text NOT NULL,
        "created_at"    timestamp DEFAULT now() NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "press_sponsors" (
        "id"         serial PRIMARY KEY,
        "name"       text NOT NULL,
        "tagline"    text,
        "url"        text,
        "color"      text NOT NULL DEFAULT '#FFD700',
        "icon"       text NOT NULL DEFAULT '⭐',
        "sort_order" integer NOT NULL DEFAULT 0
      )
    `);

    // Seed press content
    const { rows: pRows } = await pool.query(`SELECT COUNT(*) as count FROM press_posts`);
    if (parseInt(pRows[0].count) === 0) {
      const PRESS = [
        { type:'video', title:'نهائي كأس العالم 2026 — التحليل الكامل', content:'تحليل شامل للمباراة النهائية من كأس العالم 2026 بين أقوى فرق العالم. الأهداف، الأخطاء، واللحظات التاريخية.', video_url:'dSio_PS8NMg', author:'محلل الإمبراطورية', likes:142 },
        { type:'article', title:'الذكاء الاصطناعي في عالم الرياضة', content:'تحول جذري يشهده عالم الرياضة مع دخول الذكاء الاصطناعي — من التحكيم الآلي إلى تحليل أداء اللاعبين في الوقت الفعلي. هذا ليس مستقبلاً بعيداً بل هو حاضرنا اليوم.', author:'التقني الرياضي', likes:98 },
        { type:'story', title:'ميسي والكأس — قصة لن تُنسى', content:'في كأس العالم 2022، حمل ليونيل ميسي على كتفيه وزن أمة كاملة. لم يكن مجرد لاعب — كان رسالة مفتوحة لكل من قيل له "أنت صغير جداً". الملعب يتحدث، والتاريخ يكتب نفسه.', author:'قلم الأسطورة', likes:215 },
        { type:'video', title:'تحليل: أفضل 10 أهداف في تاريخ دوري الأبطال', content:'من بلاتيني إلى بيل — عشرة لحظات غيرت مفهوم الهدف للأبد في دوري أبطال أوروبا.', video_url:'ZrCUz2kbLaQ', author:'أرشيف الإمبراطورية', likes:187 },
        { type:'article', title:'ريال مدريد: الإمبراطورية التي لا تنام', content:'14 كأس أبطال أوروبا. أسماء تحفر في الذاكرة الجماعية للإنسانية — زيدان، رونالدو، بيل. ليس نادياً عادياً، بل مشروع حضاري ممتد عبر عقود.', author:'مراسل الإمبراطورية', likes:134 },
        { type:'story', title:'ليلة فيلانوفا — عندما تُهزم الأقدار', content:'في أصعب لحظات برشلونة، كان تيتو فيلانوفا يتلقى علاجه في المستشفى ويدير المباراة عبر الهاتف. بعض الانتصارات أكبر من الميداليات.', author:'الروح الرياضية', likes:76 },
      ];
      for (const p of PRESS) {
        await pool.query(
          `INSERT INTO press_posts (type,title,content,video_url,author,likes) VALUES ($1,$2,$3,$4,$5,$6)`,
          [p.type, p.title, p.content, p.video_url ?? null, p.author, p.likes]
        );
      }
      console.log("[PRESS] Seeded 6 press posts");
    }

    const { rows: polRows } = await pool.query(`SELECT COUNT(*) as count FROM press_polls`);
    if (parseInt(polRows[0].count) === 0) {
      const POLLS = [
        { q:'من هو أفضل لاعب في تاريخ كرة القدم؟', a:'ليونيل ميسي', b:'كريستيانو رونالدو', c:'بيليه', d:'مارادونا' },
        { q:'ما هو أفضل دوري كرة قدم في العالم؟', a:'الدوري الإسباني', b:'الدوري الإنجليزي', c:'الدوري الألماني', d:'الدوري الإيطالي' },
        { q:'هل سيفوز المنتخب الأفريقي بكأس العالم قبل 2030؟', a:'نعم بالتأكيد', b:'لا أظن ذلك', c:'ممكن', d:'صعب التوقع' },
        { q:'ما أهم عنصر في كرة القدم الحديثة؟', a:'الذكاء التكتيكي', b:'اللياقة البدنية', c:'الموهبة الفردية', d:'الوحدة الجماعية' },
      ];
      for (const p of POLLS) {
        await pool.query(
          `INSERT INTO press_polls (question,option_a,option_b,option_c,option_d) VALUES ($1,$2,$3,$4,$5)`,
          [p.q, p.a, p.b, p.c, p.d]
        );
      }
      console.log("[PRESS] Seeded 4 polls");
    }

    const { rows: spRows } = await pool.query(`SELECT COUNT(*) as count FROM press_sponsors`);
    if (parseInt(spRows[0].count) === 0) {
      const SPONSORS = [
        { name:'EMPIRE GOLD', tagline:'شريك الإمبراطورية الرسمي', color:'#FFD700', icon:'👑', order:1 },
        { name:'ARENA TECH', tagline:'التقنية التي تُحرّك العالم', color:'#38bdf8', icon:'⚡', order:2 },
        { name:'GLOBAL SPORT', tagline:'الرياضة بلا حدود', color:'#4ade80', icon:'⚽', order:3 },
        { name:'MEDIA FORCE', tagline:'الصوت الذي يُسمع', color:'#a78bfa', icon:'📡', order:4 },
        { name:'FUTURE VISION', tagline:'نحو أفق جديد', color:'#fb923c', icon:'🔭', order:5 },
      ];
      for (const s of SPONSORS) {
        await pool.query(
          `INSERT INTO press_sponsors (name,tagline,color,icon,sort_order) VALUES ($1,$2,$3,$4,$5)`,
          [s.name, s.tagline, s.color, s.icon, s.order]
        );
      }
      console.log("[PRESS] Seeded 5 sponsors");
    }

    // ── Sovereign Empire Media ───────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS gs_uploads (
        id            SERIAL PRIMARY KEY,
        uploader_name TEXT NOT NULL DEFAULT 'مواطن الإمبراطورية',
        title         TEXT NOT NULL,
        type          TEXT NOT NULL CHECK (type IN ('video','audio')),
        category      TEXT NOT NULL DEFAULT 'sport',
        file_path     TEXT NOT NULL,
        file_name     TEXT NOT NULL,
        file_size     BIGINT NOT NULL DEFAULT 0,
        mime_type     TEXT NOT NULL,
        views         INTEGER NOT NULL DEFAULT 0,
        earnings      DECIMAL(10,4) NOT NULL DEFAULT 0,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS gs_upload_views (
        id         SERIAL PRIMARY KEY,
        upload_id  INTEGER NOT NULL REFERENCES gs_uploads(id) ON DELETE CASCADE,
        viewer_ip  TEXT NOT NULL,
        viewed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Add figure_tag column if missing (safe ALTER)
    await pool.query(`
      ALTER TABLE gs_uploads ADD COLUMN IF NOT EXISTS figure_tag TEXT
    `);

    // Withdrawal requests
    await pool.query(`
      CREATE TABLE IF NOT EXISTS gs_withdrawals (
        id             SERIAL PRIMARY KEY,
        uploader_name  TEXT NOT NULL,
        amount_coins   DECIMAL(10,4) NOT NULL,
        amount_mad     DECIMAL(10,2) NOT NULL,
        amount_usd     DECIMAL(10,2) NOT NULL,
        status         TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','approved','paid','rejected')),
        notes          TEXT,
        requested_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        paid_at        TIMESTAMPTZ
      )
    `);

    console.log("[SOVEREIGN] Media tables verified");
    console.log("[NEURAL] Tables verified");
  } catch (err) {
    console.warn("[NEURAL] Table ensure skipped:", err);
  }
}

// ── Admin / Utility routes ────────────────────────────────────────
import express from "express";
import bcryptAdmin from "bcrypt";
const adminRouter = express.Router();

// POST /api/admin/broadcast-welcome — بث يدوي في أي وقت
adminRouter.post("/admin/broadcast-welcome", async (req, res): Promise<void> => {
  try {
    const { minXp = 0, limit = 0, force = false } = req.body ?? {};
    const result = await runWelcomeBroadcast({ minXp, limit, force });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// POST /api/admin/imperial-decree — إطلاق المراسيم الشرفية لجميع المواطنين
adminRouter.post("/admin/imperial-decree", async (req, res): Promise<void> => {
  try {
    const { force = false, aiEnhanced = true, limit = 0 } = req.body ?? {};
    const result = await runImperialDecree({ force, aiEnhanced, limit });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// GET /api/seed — يعمّر 3 مستخدمين تجريبيين مرة واحدة
adminRouter.get("/seed", async (req, res): Promise<void> => {
  try {
    const seeds = [
      { username: "CR7_Test",   email: "cr7@gdna-test.com",   password: "empire123" },
      { username: "ElQaisy",    email: "qaisy@gdna-test.com",  password: "empire123" },
      { username: "GDNANews",   email: "news@gdna-test.com",   password: "empire123" },
    ];

    const created: string[] = [];

    for (const s of seeds) {
      // تخطى إذا كان موجوداً
      const { rows: existing } = await pool.query(
        `SELECT id FROM users WHERE email=$1 OR username=$2 LIMIT 1`,
        [s.email, s.username]
      );
      if (existing.length > 0) { created.push(`${s.username} (موجود)`); continue; }

      const hash = await bcryptAdmin.hash(s.password, 10);
      const { rows } = await pool.query<{ id: number }>(
        `INSERT INTO users (username, email, password_hash, xp, balance, honor_count)
         VALUES ($1,$2,$3, 500, 100, 3)
         RETURNING id`,
        [s.username, s.email, hash]
      );
      const userId = rows[0].id;

      // رسالة ترحيب فورية
      const WELCOME_POOL = [
        { icon: "👑", title: "⚡ المملكة تستدعيك — EMPIRE ETERNAL", body: "أنت الآن جزء من الإمبراطورية الأكبر في تاريخ المحتوى الرقمي. استكشف الـ Legends، صوّت في GlobalStar، وشارك في Pulse — مكانك هنا يستحق أن يُرى." },
        { icon: "🔥", title: "🔥 الإمبراطورية تنتظر مواطناً مثلك", body: "الأبطال لا يُنتظرون — يتقدمون. زُر GlobalStar وصوّت لمن يستحق، أو أدخل الميدان في PLAY وأثبت من أنت. الأسطورة تبدأ الآن." },
        { icon: "🏆", title: "🏆 البطل لا يحتاج دعوة — هو يدخل", body: "منصة GDNA Arena جاهزة لك: Legends من كل الحضارات، GlobalStar لأفضل المواهب، ألعاب ومعارك وشرف. أين ستبدأ رحلتك؟" },
      ];
      const msg = WELCOME_POOL[userId % WELCOME_POOL.length];
      await pool.query(
        `INSERT INTO notifications (user_id, type, title, body, icon, link_path)
         VALUES ($1,'welcome_broadcast',$2,$3,$4,'/games')`,
        [userId, msg.title, msg.body, msg.icon]
      );

      console.log(`[SEED] ✅ Created → ${s.username} (id:${userId})`);
      created.push(s.username);
    }

    res.json({ ok: true, created });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.use("/api", adminRouter);

ensureTables()
  .then(() => ensureNeuralTables())
  .then(() => ensureGenomeTables())
  .then(() => {
    startHonorAlertJob();
    startWelcomeBroadcastJob();
    startImperialDecreeJob();
    startNeuralLearningJob();
    startGenomeEvolutionJob();

    // ── HTTP + WebSocket server ──────────────────────────────────────────────
    const httpServer = http.createServer(app);
    attachSignalingServer(httpServer);

    httpServer.listen(port, (err?: Error) => {
      if (err) { console.error(err); process.exit(1); }
      console.log(`[SERVER] Listening on port ${port} (HTTP + WebSocket /ws)`);
    });
  });
