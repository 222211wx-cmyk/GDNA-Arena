import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import leaderboardRouter from "./leaderboard";
import chatRouter from "./chat";
import gamesRouter from "./games";
import rewardsRouter from "./rewards";
import walletRouter from "./wallet";
import globalstarRouter from "./globalstar";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(leaderboardRouter);
router.use(chatRouter);
router.use(gamesRouter);
router.use(rewardsRouter);
router.use(walletRouter);
router.use(globalstarRouter);

export default router;
