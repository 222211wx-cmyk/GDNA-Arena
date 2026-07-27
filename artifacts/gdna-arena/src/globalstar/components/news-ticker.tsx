import { useGetGsTicker } from '@workspace/api-client-react';
import { AlertCircle } from 'lucide-react';

export function NewsTicker() {
  const { data: tickerData } = useGetGsTicker();

  if (!tickerData?.items || tickerData.items.length === 0) {
    return null;
  }

  const items = [...tickerData.items, ...tickerData.items];

  return (
    <div className="bg-card border-b border-border overflow-hidden" data-testid="news-ticker">
      <div className="relative h-10 flex items-center">
        <div className="absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-card to-transparent z-10 pointer-events-none" />
        <div className="absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-card to-transparent z-10 pointer-events-none" />
        
        <div className="flex ticker-scroll">
          {items.map((item, idx) => (
            <div
              key={`${item.id}-${idx}`}
              className="flex items-center gap-3 px-6 whitespace-nowrap"
              data-testid={`ticker-item-${item.id}`}
            >
              {item.isBreaking && (
                <span className="flex items-center gap-1 text-destructive font-bold text-xs pulse-breaking">
                  <AlertCircle className="w-3 h-3" />
                  BREAKING
                </span>
              )}
              <span className="text-sm text-muted-foreground">{item.domain}</span>
              <span className="text-sm text-foreground">{item.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
