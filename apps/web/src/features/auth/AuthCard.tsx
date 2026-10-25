import type { ReactNode } from 'react';
import { Logo } from '@/app/layouts';
import { Card, CardContent } from '@/components/ui';

export function AuthCard({ title, description, children, footer }: { title: string; description?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex flex-1 items-start justify-center px-4 py-10 sm:items-center">
      <div className="w-full max-w-md animate-fade-in">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <Card>
          <CardContent className="p-6 sm:p-8">
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
            <div className="mt-6">{children}</div>
          </CardContent>
        </Card>
        {footer ? <div className="mt-4 text-center text-sm text-muted">{footer}</div> : null}
      </div>
    </div>
  );
}
