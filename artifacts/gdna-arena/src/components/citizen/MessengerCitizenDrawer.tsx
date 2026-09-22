import { CitizenProfileDrawer } from "./CitizenProfileDrawer";
import { useCitizenProfile, type CitizenProfile } from "@/hooks/use-citizen";

export interface MessengerCitizenDrawerProps {
  /** Peer username to load; null closes the drawer. */
  username: string | null;
  onClose: () => void;
  /** Open the existing conversation with this citizen (no route navigation away). */
  onMessage: (citizen: CitizenProfile) => void;
}

/**
 * Thin bridge used by the messenger's dark conversation list: opening the drawer
 * loads the public citizen card by username via the existing React Query hook and
 * renders the shared CitizenProfileDrawer on the SAME page (no navigation).
 */
export function MessengerCitizenDrawer({ username, onClose, onMessage }: MessengerCitizenDrawerProps) {
  const isOpen = !!username;
  const query = useCitizenProfile(username ?? undefined);
  return (
    <CitizenProfileDrawer
      citizen={query.data}
      isOpen={isOpen}
      isLoading={isOpen && (query.isLoading || query.isFetching) && !query.data}
      onClose={onClose}
      onMessage={onMessage}
    />
  );
}

export default MessengerCitizenDrawer;
