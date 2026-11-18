import { useLocation, useSearch, Redirect } from "wouter";
import { Card, CardContent } from "@workspace/gdna-ds/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { useLang } from "@/contexts/LangContext";
import { messagesReturnPath } from "@/lib/messages-entry";
import { recoveryEnrollmentReturnPath } from "@/lib/recovery-links";
import { AuthFlow } from "@/components/auth/AuthFlow";

export default function Register() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { user } = useAuth();
  const { lang } = useLang();
  const destination = messagesReturnPath(search) ?? recoveryEnrollmentReturnPath(search);

  if (user) return <Redirect to={destination ?? "/social"} replace />;

  return (
    <div dir={lang === "ar" ? "rtl" : "ltr"} className="flex min-h-[calc(100dvh-4rem)] items-center justify-center p-4">
      <Card className="w-full max-w-md border-primary/20 bg-card/50 backdrop-blur-sm">
        <CardContent className="pt-6">
          <AuthFlow initial="signup-choice" onDone={() => setLocation(destination ?? "/social")} />
        </CardContent>
      </Card>
    </div>
  );
}
