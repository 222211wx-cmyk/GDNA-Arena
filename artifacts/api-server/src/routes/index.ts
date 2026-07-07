import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import leaderboardRouter from "./leaderboard";
import chatRouter from "./chat";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(leaderboardRouter);
router.use(chatRouter);

export default router;
