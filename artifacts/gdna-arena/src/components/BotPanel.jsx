import { useEffect, useState } from "react";
import { Button } from "@workspace/gdna-ds/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/gdna-ds/components/ui/card";
import { Badge } from "@workspace/gdna-ds/components/ui/badge";

const DNA_LABELS = {
  discipline: "Discipline",
  resilience: "Resilience",
  precision: "Precision",
  awareness: "Awareness",
  growth: "Growth",
  clarity: "Clarity",
  strategy: "Strategy",
  leadership: "Leadership",
  logic: "Logic",
  influence: "Influence",
  empathy: "Empathy",
  expression: "Expression",
  creation: "Creation",
  enterprise: "Enterprise",
  persistence: "Persistence",
  vision: "Vision",
  wisdom: "Wisdom",
  curiosity: "Curiosity",
};

export default function BotPanel() {
  const [fortress, setFortress] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    fetch("/api/fortress/bots")
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load the fortress.");
        return response.json();
      })
      .then((data) => live && setFortress(data))
      .catch(() => live && setError("The Fortress is temporarily unavailable."))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, []);

  async function requestChallenge(botId) {
    setUpdatingId(botId);
    setError("");
    try {
      const response = await fetch(`/api/fortress/bots/${botId}/challenge`, { method: "POST" });
      if (!response.ok) throw new Error("Unable to issue a new challenge.");
      const { bot } = await response.json();
      setFortress((current) => ({
        ...current,
        bots: current.bots.map((item) => item.id === bot.id ? bot : item),
      }));
    } catch {
      setError("Could not issue a new challenge. Please try again.");
    } finally {
      setUpdatingId(null);
    }
  }

  if (loading) {
    return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-72 animate-pulse rounded-xl bg-muted" />)}</div>;
  }

  if (error && !fortress) {
    return <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">{error}</p>;
  }

  return (
    <section aria-label="GDN-SMART FORTRESS bots">
      {error && <p className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {fortress?.bots.map((bot) => (
          <Card key={bot.id} className="border-primary/25 bg-card">
            <CardHeader className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-primary/10 text-2xl">{bot.icon}</span>
                  <div>
                    <CardTitle className="text-base tracking-wide">{bot.name}</CardTitle>
                    <CardDescription>{bot.title}</CardDescription>
                  </div>
                </div>
                <Badge variant="outline" className="border-primary/40 text-primary">ACTIVE</Badge>
              </div>
              <p className="text-xs text-muted-foreground">{bot.focus}</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-primary">Current challenge</p>
                <p className="mt-2 font-semibold text-foreground">{bot.activeChallenge.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{bot.activeChallenge.description}</p>
                <p className="mt-2 text-sm font-medium text-primary">{bot.activeChallenge.reward}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(bot.dna).map(([trait, score]) => (
                  <Badge key={trait} variant="secondary" className="text-[10px]">{DNA_LABELS[trait] ?? trait} {score}</Badge>
                ))}
              </div>
              <Button className="w-full" onClick={() => requestChallenge(bot.id)} disabled={updatingId === bot.id}>
                {updatingId === bot.id ? "Preparing..." : "تحدي جديد"}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}