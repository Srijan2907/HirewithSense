import Editor from '@monaco-editor/react';
import { LANGUAGES } from '@hws/shared';
import { setupMonaco } from '@/lib/monaco';
import { getTheme } from '@/lib/theme';

export default function CodeViewer({ code, languageId }: { code: string; languageId: string }) {
  const lang = LANGUAGES.find((l) => l.id === languageId)?.monaco ?? 'plaintext';
  const lines = Math.min(30, Math.max(6, code.split('\n').length + 1));
  return (
    <div className="overflow-hidden rounded-md border">
      <Editor
        height={`${lines * 19}px`}
        language={lang}
        value={code}
        theme={getTheme() === 'dark' ? 'vs-dark' : 'light'}
        beforeMount={() => setupMonaco()}
        options={{ readOnly: true, minimap: { enabled: false }, scrollBeyondLastLine: false, fontSize: 12, lineNumbersMinChars: 3, renderLineHighlight: 'none', domReadOnly: true }}
      />
    </div>
  );
}
