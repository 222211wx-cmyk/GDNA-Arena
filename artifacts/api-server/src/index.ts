import http from "http";
import app, { sessionMiddleware } from "./app";
import { logger } from "./lib/logger";
import { pool } from "@workspace/db";
import { attachSignalingServer } from "./lib/signaling.js";
import { smartFortress } from "./server.js";
import { startHonorAlertJob } from "./jobs/honor-alert.js";
import { startWelcomeBroadcastJob, runWelcomeBroadcast } from "./jobs/welcome-broadcast.js";
import { startImperialDecreeJob, runImperialDecree } from "./jobs/imperial-decree.js";
import { ensureNeuralTables } from "./lib/neural-core.js";
import { startNeuralLearningJob } from "./jobs/neural-learning.js";
import { ensureGenomeTables } from "./lib/genome-engine.js";
import { startGenomeEvolutionJob } from "./jobs/genome-evolution.js";
import { startCouncilReportJob } from "./jobs/council-report.js";
import { ensureMissionsTables, startSovereignMissionsJob } from "./jobs/sovereign-missions.js";
import { startEventLiveAlertJob } from "./jobs/event-live-alert.js";
import { getAgoraConfigStatus } from "./lib/agora-config.js";
import { startFinanceReconciliationJob } from "./jobs/finance-reconciliation";
import { FINANCE_SIMULATION_MODE } from "./lib/finance-simulation";

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required but was not provided.");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

logger.info(getAgoraConfigStatus(), "Agora environment configuration loaded from process.env");
logger.info({ financeSimulationMode: FINANCE_SIMULATION_MODE }, "Finance operating mode selected");

async function prepareDevelopmentDatabase(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    logger.info("Startup schema DDL skipped: production schema is managed by Publish");
    return;
  }

  await ensureTables();
  await ensureNeuralTables();
  await ensureGenomeTables();
  await ensureMissionsTables();
  await import("./routes/stars").then(m => m.ensureStarsSystem());
  await import("./routes/rights").then(m => m.ensureRightsTables());
  await import("./routes/ppo").then(m => m.ensurePpoTables());
  await import("./routes/clips").then(m => m.ensureClipsTables());
}

const SPORT_LEGEND_IMAGE_URLS: Record<string, string> = {
  "Cristiano Ronaldo": "/assets/legends/cristiano-ronaldo.jpg",
  "Lionel Messi": "/assets/legends/lionel-messi.jpg",
  "LeBron James": "/assets/legends/lebron-james.jpg",
  "Roger Federer": "/assets/legends/roger-federer.jpg",
  "Serena Williams": "/assets/legends/serena-williams.jpg",
  "Muhammad Ali": "/assets/legends/muhammad-ali.jpg",
};

const SEED_LEGENDS = [
  {
    rank: 1, name: "Cristiano Ronaldo", domain: "sport", nationality: "Portuguese", score: 9820,
    imageUrl: SPORT_LEGEND_IMAGE_URLS["Cristiano Ronaldo"],
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
    imageUrl: SPORT_LEGEND_IMAGE_URLS["Lionel Messi"],
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
    imageUrl: SPORT_LEGEND_IMAGE_URLS["LeBron James"],
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
    imageUrl: SPORT_LEGEND_IMAGE_URLS["Roger Federer"],
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
    imageUrl: SPORT_LEGEND_IMAGE_URLS["Serena Williams"],
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
    imageUrl: SPORT_LEGEND_IMAGE_URLS["Muhammad Ali"],
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

// Additional music legends added after initial seed — upserted by name on startup
const EXTRA_MUSIC_LEGENDS = [
  {
    rank: 11, name: "Michael Jackson", domain: "music", nationality: "American", score: 9820,
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/31/Michael_Jackson_in_1988.jpg/400px-Michael_Jackson_in_1988.jpg",
    peakYear: 1983,
    bio: {
      childhood: "Born August 29, 1958 in Gary, Indiana. The seventh of nine children in a tiny house. His father managed the Jackson 5 with an iron fist. Michael sang before he could speak a sentence clearly.",
      training: "Trained from age 5 under the strictest conditions. By 10 he was carrying grown men's shows on a child's shoulders. He studied Fred Astaire, James Brown, and Marcel Marceau simultaneously.",
      breakthrough: "Thriller (1983) — the best-selling album in history. The moonwalk debuted on live television and stopped time. The entire world paused and never quite returned to normal.",
      stardom: "13 Grammy Awards in a single night. 400 million records sold. The moonwalk. The glove. Neverland. Michael Jackson didn't just become famous — he became the definition of global pop culture."
    },
    videos: [
      { youtubeId: "sOnqjkJTMaA", title: "Thriller — The Greatest Music Video Ever Made" },
      { youtubeId: "h_D3VFfhvs4", title: "Billie Jean Live — Moonwalk Debut 1983" },
      { youtubeId: "LeiFF0BxNMk", title: "Black or White — HIStory World Tour" },
    ],
    stats: { clutch: 97, legacy: 99, style: 99, impact: 99, peak: 99 },
  },
  {
    rank: 12, name: "Bob Marley", domain: "music", nationality: "Jamaican", score: 9380,
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a4/Bob-Marley-in-Concert_Zurich_05-30-80.jpg/400px-Bob-Marley-in-Concert_Zurich_05-30-80.jpg",
    peakYear: 1977,
    bio: {
      childhood: "Born February 6, 1945 in Nine Mile, Saint Ann Parish, Jamaica. Son of a white plantation overseer and a young Black Jamaican woman. He grew up between two worlds and belonged fully to neither — and then to both.",
      training: "Taught himself guitar on a homemade instrument. Formed the Wailers in Trench Town, Kingston, one of Jamaica's most volatile communities. Music was survival and protest at once.",
      breakthrough: "Catch a Fire (1973) — the first reggae album marketed internationally as a 'proper' rock album. The world heard Jamaica's voice for the first time and could not unhear it.",
      stardom: "Legend — the best-selling reggae album of all time. 'No Woman No Cry'. 'One Love'. 'Redemption Song'. Bob Marley turned music into a spiritual and political movement that outlived him by generations."
    },
    videos: [
      { youtubeId: "MIT5TB3XREQ", title: "No Woman No Cry — Live at the Rainbow 1977" },
      { youtubeId: "NzVJJADWNfk", title: "Redemption Song — Acoustic Original" },
      { youtubeId: "5JMss11MBe4", title: "One Love — The Anthem of a Generation" },
    ],
    stats: { clutch: 88, legacy: 99, style: 92, impact: 98, peak: 91 },
  },
  {
    rank: 13, name: "Elvis Presley", domain: "music", nationality: "American", score: 9150,
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Elvis_Presley_promoting_Jailhouse_Rock.jpg/400px-Elvis_Presley_promoting_Jailhouse_Rock.jpg",
    peakYear: 1956,
    bio: {
      childhood: "Born January 8, 1935 in Tupelo, Mississippi in a two-room house his father built. His twin brother Jesse was stillborn. Elvis grew up believing he carried two destinies. He was right.",
      training: "Sang gospel in church. Taught himself guitar. Walked into Sun Studio in Memphis in 1953 to record a song for his mother. Sam Phillips heard something that had never existed before.",
      breakthrough: "Heartbreak Hotel (1956) — #1 for 8 weeks. His first national television appearance caused a moral panic. Half of America was scandalized. The other half bought the record.",
      stardom: "18 number-one hits. 33 films. The Las Vegas residency. The jumpsuit. Elvis Presley invented the concept of the rock star and everything that came after owes him a debt it can never repay."
    },
    videos: [
      { youtubeId: "gj0Rz-uP4Mk", title: "Jailhouse Rock — The Performance That Changed Music" },
      { youtubeId: "PU5xxh5UX4U", title: "Suspicious Minds — Las Vegas 1970" },
      { youtubeId: "ApNx-EWAZX4", title: "Elvis — The '68 Comeback Special" },
    ],
    stats: { clutch: 88, legacy: 97, style: 95, impact: 96, peak: 93 },
  },
  {
    rank: 14, name: "Whitney Houston", domain: "music", nationality: "American", score: 8970,
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bf/Whitney_Houston_Welcome_Home_Heroes_1991.jpg/400px-Whitney_Houston_Welcome_Home_Heroes_1991.jpg",
    peakYear: 1992,
    bio: {
      childhood: "Born August 9, 1963 in Newark, New Jersey. Daughter of gospel singer Cissy Houston and goddaughter of Aretha Franklin. She grew up surrounded by voices of God. Hers was the greatest.",
      training: "Sang in the New Hope Baptist Junior Choir from age 11. Her mother trained her. Every note was a lesson in precision, power, and soul simultaneously. She made difficulty look like breathing.",
      breakthrough: "Her debut album in 1985 produced three #1 singles — a record at the time. But it was 'I Will Always Love You' in 1992 that became the single greatest vocal performance in pop history.",
      stardom: "Two Emmy Awards, six Grammy Awards, 30 Billboard Music Awards. The Bodyguard soundtrack remains one of the best-selling albums ever. When Whitney Houston sang, the room was not a room anymore."
    },
    videos: [
      { youtubeId: "eH3giaIzONA", title: "I Will Always Love You — The Definitive Performance" },
      { youtubeId: "GvD3ej8dBnM", title: "Greatest Love of All — Live at Wembley" },
      { youtubeId: "XSbZidsgMfw", title: "Whitney Houston — One Moment in Time" },
    ],
    stats: { clutch: 93, legacy: 95, style: 91, impact: 93, peak: 99 },
  },
  {
    rank: 15, name: "Tupac Shakur", domain: "music", nationality: "American", score: 8740,
    imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a6/Tupac_Shakur_photo.jpg/400px-Tupac_Shakur_photo.jpg",
    peakYear: 1996,
    bio: {
      childhood: "Born June 16, 1971 in East Harlem, New York City. His mother Afeni Shakur was a Black Panther. He was born into revolution and raised in its aftermath. Poetry and performance found him before the streets could claim him completely.",
      training: "Attended the Baltimore School for the Arts where he studied acting, poetry, jazz, and ballet. He was a scholarship student who absorbed everything. The contradiction of tenderness and fury was not a performance — it was who he was.",
      breakthrough: "'Dear Mama' (1995) — a love letter to a struggling mother that stopped the entire hip-hop world and made grown men weep in public. Nothing had been said that honestly in the genre before.",
      stardom: "75 million records sold. All Eyez on Me — one of the best-selling rap albums ever. He recorded over 200 songs in the final year of his life. Tupac Shakur was not just a rapper. He was a prophecy in verse."
    },
    videos: [
      { youtubeId: "Mb1ZvUDvLDY", title: "Dear Mama — The Most Emotional Hip-Hop Song Ever" },
      { youtubeId: "GLb0-f0mWvE", title: "California Love — Iconic Music Video" },
      { youtubeId: "fPr3yvkHYsE", title: "Changes — The Song That Outlived an Era" },
    ],
    stats: { clutch: 88, legacy: 97, style: 92, impact: 95, peak: 91 },
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
        "image_url" text,
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
        "notified_live" boolean NOT NULL DEFAULT false,
        "created_at" timestamp DEFAULT now() NOT NULL
      )
    `);
    // Add notified_live to pulse_events (safe — IF NOT EXISTS)
    await pool.query(`ALTER TABLE "pulse_events" ADD COLUMN IF NOT EXISTS "notified_live" boolean NOT NULL DEFAULT false`);
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
        { username:"TechProphet", content:"AI is not the future. AI is now. Arena Qaisypro runs on neural intelligence — built for the age of machine wisdom. 🔮", domain:"tech", type:"vision" },
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
    // Add notified_live to legend_arena_events now that the table exists
    await pool.query(`ALTER TABLE "legend_arena_events" ADD COLUMN IF NOT EXISTS "notified_live" boolean NOT NULL DEFAULT false`);

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

    // Repair existing seed rows created before sport photos were hosted locally.
    for (const [name, imageUrl] of Object.entries(SPORT_LEGEND_IMAGE_URLS)) {
      await pool.query(
        `UPDATE "legends" SET image_url = $1 WHERE name = $2 AND domain = 'sport'`,
        [imageUrl, name],
      );
    }

    // Upsert extra music legends by name (runs on every startup; idempotent)
    for (const l of EXTRA_MUSIC_LEGENDS) {
      const { rows: existing } = await pool.query(`SELECT id FROM "legends" WHERE name = $1`, [l.name]);
      if (existing.length === 0) {
        await pool.query(
          `INSERT INTO "legends" (name, domain, nationality, rank, score, image_url, peak_year, bio, videos, stats)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [l.name, l.domain, l.nationality, l.rank, l.score, l.imageUrl, l.peakYear,
           JSON.stringify(l.bio), JSON.stringify(l.videos), JSON.stringify(l.stats)]
        );
        console.log(`[NEURAL] Inserted music legend: ${l.name}`);
      }
    }

    // ── Ensure cinema legends (upsert — runs every boot) ──────────────────────
    const CINEMA_LEGENDS = [
      {
        rank: 11, name: "Stanley Kubrick", domain: "cinema", nationality: "American", score: 9800,
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/86/Kubrick_cropped.jpg/400px-Kubrick_cropped.jpg",
        peakYear: 1968,
        bio: {
          childhood: "Born July 26, 1928 in New York City. The son of a doctor, Stanley grew up a chess prodigy and a self-taught photographer. He was obsessive by nature — he memorised entire encyclopaedias and played chess with strangers in Central Park for money.",
          training: "He dropped out of high school and became a staff photographer for Look magazine at 17. By his early twenties he had saved enough to self-finance his first short films. He learned cinema frame by frame, studying every technique himself.",
          breakthrough: "Paths of Glory (1957) put him on the map. Spartacus (1960) gave him Hollywood clout. Then he retreated to England and built his own universe — 2001: A Space Odyssey (1968) arrived and rewrote what cinema could be.",
          stardom: "The Shining. Full Metal Jacket. A Clockwork Orange. Dr. Strangelove. Each film a genre-defining masterwork in a different genre. Kubrick never made two films alike. He made only 13 features — and every one is studied in film schools today.",
        },
        videos: [
          { youtubeId: "oR_e9y-bka0", title: "2001: A Space Odyssey — The Dawn of Man" },
          { youtubeId: "SVZDOdM7BNM", title: "The Shining — All Work and No Play" },
          { youtubeId: "mAUr8PTQQDQ", title: "Stanley Kubrick: The Cinematic Universe" },
        ],
        stats: { clutch: 97, legacy: 99, style: 98, impact: 96, peak: 99 },
      },
      {
        rank: 12, name: "Quentin Tarantino", domain: "cinema", nationality: "American", score: 9400,
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0b/Quentin_Tarantino_by_Gage_Skidmore.jpg/400px-Quentin_Tarantino_by_Gage_Skidmore.jpg",
        peakYear: 1994,
        bio: {
          childhood: "Born March 27, 1963 in Knoxville, Tennessee. Raised in Los Angeles, he was obsessed with films from childhood. He memorised every movie at the video store where he worked. No film school — just 10,000 hours of watching.",
          training: "He worked at Video Archives in Manhattan Beach for five years, devouring every genre — spaghetti westerns, Hong Kong action, French new wave, blaxploitation. That store was his university.",
          breakthrough: "Reservoir Dogs (1992) detonated at Sundance. Two years later, Pulp Fiction won the Palme d'Or at Cannes and grossed $200M on a $8M budget. Hollywood was never the same.",
          stardom: "Kill Bill. Inglourious Basterds. Django Unchained. The Hateful Eight. Once Upon a Time in Hollywood. Nine films. He announced he would stop at ten. Every one a cultural event. Tarantino doesn't adapt — he transfigures.",
        },
        videos: [
          { youtubeId: "s7EdQ4FqbhY", title: "Pulp Fiction — Ezekiel 25:17" },
          { youtubeId: "CY4SMVTMXWQ", title: "Kill Bill Vol. 1 — The Crazy 88 Fight" },
          { youtubeId: "2m2P9YL0mOY", title: "Inglourious Basterds — Opening Scene" },
        ],
        stats: { clutch: 95, legacy: 92, style: 99, impact: 94, peak: 96 },
      },
      {
        rank: 13, name: "Martin Scorsese", domain: "cinema", nationality: "American", score: 9300,
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a6/Martin_Scorsese_Sept_2018.jpg/400px-Martin_Scorsese_Sept_2018.jpg",
        peakYear: 1990,
        bio: {
          childhood: "Born November 17, 1942 in Queens, New York. Raised in Little Italy by Sicilian immigrant parents. Too asthmatic to play outside, he watched films with his father from age 3. The cinema was his only door to the world.",
          training: "Studied at NYU Film School when it was the most radical film programme in America. He and Francis Coppola and Brian De Palma were rewriting Hollywood's rules before they had budgets.",
          breakthrough: "Mean Streets (1973) with a young Robert De Niro. Taxi Driver (1976) won the Palme d'Or. Raging Bull (1980) is on every shortlist of the greatest films ever made.",
          stardom: "Goodfellas. Casino. The Departed. The Wolf of Wall Street. Killers of the Flower Moon. Fifty years and no plateau. Scorsese is cinema's living conscience — simultaneously its greatest artist and its most vocal defender.",
        },
        videos: [
          { youtubeId: "QKL_WS3oUjk", title: "Goodfellas — Long Take Copacabana Scene" },
          { youtubeId: "sY1S34973zA", title: "Taxi Driver — You Talkin to Me?" },
          { youtubeId: "1G9bWt6b9xY", title: "Martin Scorsese: A Life in Cinema" },
        ],
        stats: { clutch: 96, legacy: 97, style: 93, impact: 95, peak: 95 },
      },
      {
        rank: 14, name: "Akira Kurosawa", domain: "cinema", nationality: "Japanese", score: 9200,
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Akira_Kurosawa.jpg/400px-Akira_Kurosawa.jpg",
        peakYear: 1954,
        bio: {
          childhood: "Born March 23, 1910 in Tokyo. The youngest of eight children, his father was a military physical instructor who also believed in Western arts and films. A childhood marked by the Great Kanto Earthquake shaped his sense of beauty amid catastrophe.",
          training: "He failed his first application to Toho Studios. Tried again. Was hired as an assistant director and spent a decade studying every technical role from below. Patience was his training method.",
          breakthrough: "Rashomon (1950) was submitted to the Venice Film Festival by Daiei Studios without Kurosawa's knowledge. It won the Golden Lion. The West discovered Japanese cinema in an afternoon.",
          stardom: "Seven Samurai. Ikiru. Ran. Yojimbo. Kagemusha. He invented cinematic grammar — the wipe transition, the telephoto action sequence, the morally ambiguous hero. George Lucas, Spielberg, and Coppola all called him their master.",
        },
        videos: [
          { youtubeId: "UB9OVuQsGqE", title: "Seven Samurai — The Final Battle" },
          { youtubeId: "fNDpBW7mPns", title: "Ran — The Fire Sequence" },
          { youtubeId: "jVsUMdBFWOI", title: "Akira Kurosawa — The Art of Influence" },
        ],
        stats: { clutch: 90, legacy: 99, style: 95, impact: 98, peak: 97 },
      },
      {
        rank: 15, name: "Meryl Streep", domain: "cinema", nationality: "American", score: 9100,
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/60/Meryl_Streep_December_2018.jpg/400px-Meryl_Streep_December_2018.jpg",
        peakYear: 1982,
        bio: {
          childhood: "Born June 22, 1949 in Summit, New Jersey. She sang opera as a teenager, studied drama at Vassar, then Yale. Her teachers said she was gifted but too intellectual. She used that as fuel.",
          training: "Yale School of Drama graduate. She mastered accents as a technical skill — Polish, British, Danish, Australian, Irish, Southern American. Her preparation is legendarily obsessive, her research exhaustive.",
          breakthrough: "The Deer Hunter (1978). Kramer vs Kramer (1979) — Oscar. Sophie's Choice (1982) — second Oscar for a Polish accent so perfect Polish viewers thought she was native. She was 33.",
          stardom: "Three Academy Awards from 21 nominations — the most for any actor in history. Doubt. The Devil Wears Prada. Angels in America. She doesn't perform characters. She inhabits lives. The benchmark against which all screen acting is measured.",
        },
        videos: [
          { youtubeId: "nLzJwJI2hBw", title: "Sophie's Choice — The Selection Scene" },
          { youtubeId: "7ZDiJTMBaOM", title: "The Devil Wears Prada — That's All" },
          { youtubeId: "VZDpMlOhwpE", title: "Meryl Streep — The Acting Master Class" },
        ],
        stats: { clutch: 98, legacy: 95, style: 92, impact: 91, peak: 97 },
      },
      {
        rank: 16, name: "Christopher Nolan", domain: "cinema", nationality: "British-American", score: 8900,
        imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/95/Christopher_Nolan_Cannes_2018.jpg/400px-Christopher_Nolan_Cannes_2018.jpg",
        peakYear: 2008,
        bio: {
          childhood: "Born July 30, 1970 in London. The son of a British advertising executive and an American flight attendant, he made 8mm films with his father's camera starting at age 7. Narrative obsession was in him from the start.",
          training: "Studied English Literature at Cambridge, not film — a fact he considers essential. He made 16mm short films on weekends using borrowed equipment, learning to maximise every frame of expensive film stock.",
          breakthrough: "Memento (2000) — made for $9,000, acquired by distributors, turned global phenomenon. Nolan had invented a new syntax for non-linear storytelling. He was 30.",
          stardom: "The Dark Knight. Inception. Interstellar. Dunkirk. Oppenheimer. He makes blockbusters that respect intelligence, films of genuine philosophical weight that gross a billion dollars. The rarest achievement in cinema.",
        },
        videos: [
          { youtubeId: "EXeTwQWrcwY", title: "The Dark Knight — Why So Serious?" },
          { youtubeId: "8hP9D6kZseM", title: "Inception — The Rotating Hallway" },
          { youtubeId: "Rt7HVMBFvqg", title: "Interstellar — Docking Scene TARS" },
        ],
        stats: { clutch: 94, legacy: 88, style: 91, impact: 93, peak: 96 },
      },
    ];
    for (const cl of CINEMA_LEGENDS) {
      await pool.query(
        `INSERT INTO "legends" (name, domain, nationality, rank, score, image_url, peak_year, bio, videos, stats)
         SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
         WHERE NOT EXISTS (SELECT 1 FROM "legends" WHERE name = $1 AND domain = $2)`,
        [cl.name, cl.domain, cl.nationality, cl.rank, cl.score, cl.imageUrl, cl.peakYear,
         JSON.stringify(cl.bio), JSON.stringify(cl.videos), JSON.stringify(cl.stats)]
      );
    }
    console.log("[CINEMA] Ensured 6 cinema legends");

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
    // Per-member read cursor — add if the table already existed without it
    await pool.query(`
      ALTER TABLE "dm_room_members" ADD COLUMN IF NOT EXISTS "last_read_at" timestamp
    `);
    // DM XP cooldown cursor on users — add if missing
    await pool.query(`
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_dm_xp_at" timestamptz
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "dm_messages" (
        "id" serial PRIMARY KEY, "room_id" integer NOT NULL, "user_id" integer,
        "username" text NOT NULL DEFAULT 'Anonymous', "content" text,
        "audio_url" text, "video_url" text, "file_url" text, "type" text NOT NULL DEFAULT 'text',
        "is_read" boolean NOT NULL DEFAULT false, "created_at" timestamp DEFAULT now() NOT NULL
      )
    `);
    await pool.query(`ALTER TABLE "dm_messages" ADD COLUMN IF NOT EXISTS "reply_to_id" integer`);
    await pool.query(`CREATE TABLE IF NOT EXISTS "dm_message_reactions" (
      "id" serial PRIMARY KEY, "message_id" integer NOT NULL, "user_id" integer NOT NULL,
      "reaction" text NOT NULL CHECK (reaction IN ('support','listen','celebrate')),
      "created_at" timestamp NOT NULL DEFAULT now(), UNIQUE ("message_id", "user_id")
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS "citizen_blocks" (
      "id" serial PRIMARY KEY, "blocker_id" integer NOT NULL, "blocked_id" integer NOT NULL,
      "created_at" timestamp NOT NULL DEFAULT now(), UNIQUE ("blocker_id", "blocked_id"),
      CHECK ("blocker_id" <> "blocked_id")
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS "citizen_solidarity_profiles" (
      "user_id" integer PRIMARY KEY, "score" integer NOT NULL DEFAULT 0,
      "initiatives_completed" integer NOT NULL DEFAULT 0, "supports_completed" integer NOT NULL DEFAULT 0,
      "status" text NOT NULL DEFAULT 'available' CHECK ("status" IN ('available','listening','seeking','focused','offline')),
      "status_visible" boolean NOT NULL DEFAULT true, "updated_at" timestamp NOT NULL DEFAULT now()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS "solidarity_initiatives" (
      "id" serial PRIMARY KEY, "creator_id" integer NOT NULL, "title" text NOT NULL, "body" text NOT NULL,
      "domain" text NOT NULL, "room_id" integer, "target_support" integer NOT NULL CHECK ("target_support" >= 3),
      "status" text NOT NULL DEFAULT 'open' CHECK ("status" IN ('open','completed','cancelled')),
      "completed_at" timestamp, "created_at" timestamp NOT NULL DEFAULT now()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS "solidarity_supports" (
      "id" serial PRIMARY KEY, "initiative_id" integer NOT NULL, "user_id" integer NOT NULL,
      "created_at" timestamp NOT NULL DEFAULT now(), UNIQUE ("initiative_id", "user_id")
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS "solidarity_reward_ledger" (
      "id" serial PRIMARY KEY, "user_id" integer NOT NULL, "initiative_id" integer NOT NULL,
      "role" text NOT NULL CHECK ("role" IN ('creator','supporter')),
      "amount" integer NOT NULL CHECK ("amount" IN (5,10)),
      "reward_date" date NOT NULL, "created_at" timestamptz NOT NULL DEFAULT now(),
      UNIQUE ("user_id", "initiative_id", "role"),
      UNIQUE ("user_id", "reward_date", "role")
    )`);

    // ── Notifications table ───────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "notifications" (
        "id" serial PRIMARY KEY, "user_id" integer NOT NULL,
        "type" text NOT NULL, "title" text NOT NULL, "body" text NOT NULL,
        "icon" text NOT NULL DEFAULT '⚡', "is_read" boolean NOT NULL DEFAULT false,
        "link_path" text, "source_ref" text, "created_at" timestamp DEFAULT now() NOT NULL
      )
    `);

    // Add source_ref to existing notifications table (safe — IF NOT EXISTS)
    await pool.query(`ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "source_ref" text`);
    // Unique index prevents duplicate fan-out notifications per (user, event)
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "notifications_user_source_uniq"
      ON "notifications" ("user_id", "source_ref")
      WHERE "source_ref" IS NOT NULL
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
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "post_reactions" (
        "id" serial PRIMARY KEY,
        "post_id" integer NOT NULL,
        "user_id" integer,
        "username" text NOT NULL DEFAULT 'Anonymous',
        "voter_ip" text NOT NULL,
        "reaction" text NOT NULL DEFAULT '❤️',
        "created_at" timestamp DEFAULT now() NOT NULL,
        UNIQUE("post_id","voter_ip")
      )
    `);
    await pool.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "honor_count" integer NOT NULL DEFAULT 0`);
    await pool.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "birth_date" date`);
    await pool.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_muted" boolean NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "honor_title" text NOT NULL DEFAULT 'Citizen'`);
    await pool.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_trending" boolean NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "honor_alert_sent" boolean NOT NULL DEFAULT false`);
    console.log("[HONOR] Citizen Honor System tables ready");

    // Social Hub v2 — saved posts + call history + new columns
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "saved_posts" (
        "id" serial PRIMARY KEY,
        "user_id" integer NOT NULL,
        "post_id" integer NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        UNIQUE("user_id","post_id")
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "call_history" (
        "id" serial PRIMARY KEY,
        "caller_id" integer NOT NULL,
        "caller_username" text NOT NULL DEFAULT '',
        "callee_id" integer,
        "callee_username" text NOT NULL DEFAULT '',
        "call_type" text NOT NULL DEFAULT 'audio',
        "status" text NOT NULL DEFAULT 'missed',
        "duration_sec" integer NOT NULL DEFAULT 0,
        "started_at" timestamp DEFAULT now() NOT NULL
      )
    `);
    await pool.query(`ALTER TABLE "pulse_posts"  ADD COLUMN IF NOT EXISTS "image_url" text`);
    await pool.query(`ALTER TABLE "dm_messages"  ADD COLUMN IF NOT EXISTS "file_url"  text`);
    await pool.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamp DEFAULT now()`);
    console.log("[SOCIAL-V2] saved_posts, call_history tables ready; new columns added");

    // Pillar Completions & Streaks
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "pillar_completions" (
        "id" serial PRIMARY KEY,
        "user_id" integer NOT NULL,
        "pillar" text NOT NULL,
        "date_key" text NOT NULL,
        "streak" integer NOT NULL DEFAULT 1,
        "created_at" timestamp DEFAULT now() NOT NULL,
        UNIQUE("user_id","pillar","date_key")
      )
    `);
    console.log("[PILLARS] pillar_completions table ready");

    // Empire Shop
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "purchases" (
        "id"         serial PRIMARY KEY,
        "user_id"    integer NOT NULL,
        "item_id"    integer NOT NULL,
        "item_name"  text NOT NULL DEFAULT '',
        "coins_spent" integer NOT NULL DEFAULT 0,
        "created_at" timestamp DEFAULT now() NOT NULL
      )
    `);
    console.log("[SHOP] purchases table ready");

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
import { requireAdmin } from "./middleware/require-admin";
const adminRouter = express.Router();

// All /admin/* routes require a logged-in admin — previously wide open.
adminRouter.use("/admin", requireAdmin);

// POST /api/admin/broadcast-welcome — بث يدوي في أي وقت
adminRouter.post("/admin/broadcast-welcome", async (req, res): Promise<void> => {
  try {
    const { minXp = 0, limit = 0, force = false, aiEnhanced = true } = req.body ?? {};
    const result = await runImperialDecree({ force, aiEnhanced, limit });
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
adminRouter.get("/seed", requireAdmin, async (req, res): Promise<void> => {
  try {
    if (process.env.NODE_ENV === "production") {
      res.status(403).json({ error: "Seeding is disabled in production" });
      return;
    }
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
        { icon: "🏆", title: "🏆 البطل لا يحتاج دعوة — هو يدخل", body: "منصة Arena Qaisypro جاهزة لك: Legends من كل الحضارات، GlobalStar لأفضل المواهب، ألعاب ومعارك وشرف. أين ستبدأ رحلتك؟" },
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

/* ─── Auto-seed 10 test citizens if DB has fewer than 3 users ─────────────── */
async function autoSeedTestUsers() {
  try {
    const { rows: cnt } = await pool.query(`SELECT COUNT(*)::int AS n FROM users`);
    if (cnt[0].n >= 15) return;
    const citizens = [
      { username: "Yusuf_Al_Rashid",  email: "yusuf@gdna-test.com"    },
      { username: "Layla_Haddad",     email: "layla@gdna-test.com"     },
      { username: "Omar_Farouq",      email: "omar@gdna-test.com"      },
      { username: "Nour_Khalil",      email: "nour@gdna-test.com"      },
      { username: "Karim_Benzema99",  email: "karim@gdna-test.com"     },
      { username: "Sara_Alfarsi",     email: "sara@gdna-test.com"      },
      { username: "Hamza_Empire",     email: "hamza@gdna-test.com"     },
      { username: "Dina_Stars",       email: "dina@gdna-test.com"      },
      { username: "Ziad_Phoenix",     email: "ziad@gdna-test.com"      },
      { username: "Iman_Legends",     email: "iman@gdna-test.com"      },
    ];
    const hash = await bcryptAdmin.hash("empire123", 10);
    for (const c of citizens) {
      const { rows: ex } = await pool.query(`SELECT id FROM users WHERE email=$1 OR username=$2 LIMIT 1`, [c.email, c.username]);
      if (ex.length) continue;
      const xp      = Math.floor(Math.random() * 5000) + 500;
      const balance = Math.floor(Math.random() * 2000) + 100;
      const { rows } = await pool.query<{ id: number }>(
        `INSERT INTO users (username, email, password_hash, xp, balance, honor_count, last_seen_at)
         VALUES ($1,$2,$3,$4,$5,3, NOW() - INTERVAL '${Math.floor(Math.random() * 120)} minutes')
         RETURNING id`,
        [c.username, c.email, hash, xp, balance]
      );
      console.log(`[SEED] ✅ ${c.username} (id:${rows[0].id})`);
    }
    console.log("[SEED] 🌱 10 test citizens seeded");
  } catch (e) { console.warn("[SEED] warn:", e); }
}

// Development may retain legacy table initializers. Production startup never
// performs schema DDL; Publish owns the production schema.
prepareDevelopmentDatabase()
  .then(() => autoSeedTestUsers())
  .then(() => {
    const fortress = smartFortress.START();
    logger.info(
      { bots: fortress.bots.length, autoUpdateMinutes: fortress.autoUpdateMinutes },
      "GDN-SMART FORTRESS started"
    );
    startHonorAlertJob();
    startWelcomeBroadcastJob();
    startImperialDecreeJob();
    startNeuralLearningJob();
    startGenomeEvolutionJob();
    startCouncilReportJob();
    startSovereignMissionsJob();
    startEventLiveAlertJob();
    startFinanceReconciliationJob();

    // ── HTTP + WebSocket server ──────────────────────────────────────────────
    const httpServer = http.createServer(app);
    // Large streamed multipart requests may take hours. Socket inactivity,
    // bounded body parsers and authenticated Tus chunks remain enforced.
    httpServer.requestTimeout = 0;
    httpServer.on("request", (req, res) => {
      const path = (req.url ?? "").split("?", 1)[0];
      const longUpload = req.method === "POST" &&
        ["/api/clip/upload-final", "/api/clip/upload-simple", "/api/clip/upload", "/api/clips"].includes(path) &&
        req.headers["content-type"]?.startsWith("multipart/form-data");
      const tusChunk = req.method === "PATCH" && /^\/api\/clips\/uploads\/[a-f0-9-]+$/i.test(path);
      if (longUpload || tusChunk || req.complete) return;
      // Preserve Node's former five-minute body-receive deadline everywhere
      // else; streamed multipart and authenticated, bounded Tus chunks use inactivity.
      const deadline = setTimeout(() => req.destroy(), 5 * 60_000);
      deadline.unref();
      const clear = () => clearTimeout(deadline);
      req.once("end", clear);
      req.once("close", clear);
      res.once("finish", clear);
    });
    attachSignalingServer(httpServer, sessionMiddleware);

    httpServer.listen(port, (err?: Error) => {
      if (err) { console.error(err); process.exit(1); }
      console.log(`[SERVER] Listening on port ${port} (HTTP + WebSocket /api/ws)`);
    });
  });
