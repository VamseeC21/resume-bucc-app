import { Card, CardContent } from '@/components/ui/card';
import { FileX2 } from 'lucide-react';

/** Mount this at /apply in App.tsx to close applications; swap back to <Apply /> to reopen. */
export default function ApplicationClosed() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="glass-panel max-w-md w-full">
        <CardContent className="pt-6">
          <div className="text-center">
            <div className="inline-flex items-center justify-center mb-4">
              <img src="/bucc-logo.png" alt="BUCC Logo" className="w-16 h-16 object-contain" />
            </div>
            <FileX2 className="w-14 h-14 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-2xl font-bold mb-2">Application is closed</h2>
            <p className="text-muted-foreground">
              We are not currently accepting applications. Check back later for the next application period.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
