// ── Shared TypeScript interfaces for the Social Hub ───────────────────────────

export interface FeedPost {
  id: number;
  userId?: number;
  username: string;
  content: string;
  domain: string;
  type: string;
  likes: number;
  commentCount: number;
  imageUrl?: string;
  createdAt: string;
}

export interface Comment {
  id: number;
  postId: number;
  userId?: number;
  username: string;
  content: string;
  createdAt: string;
}

export interface DmRoom {
  id: number;
  name?: string;
  type: string;   // direct | group
  icon?: string;
  createdAt: string;
  members: { userId: number; username: string }[];
  lastMessage?: { content?: string; type: string; createdAt: string } | null;
  unreadCount: number;
}

export interface DmMessage {
  id: number;
  roomId: number;
  userId?: number;
  username: string;
  content?: string;
  audioUrl?: string;
  fileUrl?: string;
  type: string;   // text | audio | file
  createdAt: string;
}

export interface Story {
  id: number;
  username: string;
  content: string;
  imageUrl?: string;
  domain: string;
  likes: number;
  expiresAt: string;
  createdAt: string;
}

export interface Citizen {
  id: number;
  username: string;
  xp: number;
  balance: number;
  rank: { label: string; icon: string; color: string };
}

export interface CallRecord {
  id: number;
  callerId: number;
  callerUsername: string;
  calleeId?: number;
  calleeUsername: string;
  callType: string;   // audio | video
  status: string;     // answered | missed | ended
  durationSec: number;
  startedAt: string;
}

export interface NotifItem {
  type: string;       // comment | reaction | follow | call_missed
  username: string;
  content: string;
  postSnippet?: string;
  createdAt: string;
}

export interface SearchHit {
  posts:    { id: number; username: string; content: string; createdAt: string }[];
  citizens: { id: number; username: string; xp: number; rank: { label: string; icon: string; color: string } }[];
  stories:  { id: number; username: string; content: string; createdAt: string }[];
}
