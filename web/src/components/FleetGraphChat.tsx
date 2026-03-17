import { useState, useRef, useEffect } from 'react';
import { useFleetGraphChat, useFleetGraphFindings, useApproveFinding, useDismissFinding, useFleetGraphStatus } from '@/hooks/useFleetGraph';
import { cn } from '@/lib/cn';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface FleetGraphChatProps {
  isOpen: boolean;
  onClose: () => void;
  documentId?: string;
  documentType?: string;
}

export function FleetGraphChat({ isOpen, onClose, documentId, documentType }: FleetGraphChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [activeTab, setActiveTab] = useState<'chat' | 'findings'>('chat');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const chatMutation = useFleetGraphChat();
  const { data: findingsData } = useFleetGraphFindings();
  const { data: statusData } = useFleetGraphStatus();
  const approveMutation = useApproveFinding();
  const dismissMutation = useDismissFinding();

  const findings = findingsData?.findings ?? [];
  const pendingCount = statusData?.pendingCount ?? 0;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || chatMutation.isPending) return;

    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);

    try {
      const result = await chatMutation.mutateAsync({
        message: userMsg,
        documentId,
        documentType,
      });
      setMessages(prev => [...prev, { role: 'assistant', content: result.response }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, I encountered an error. Please try again.' }]);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed right-0 top-0 z-50 flex h-full w-96 flex-col border-l border-border bg-background shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent/20">
            <FleetGraphIcon className="h-4 w-4 text-accent" />
          </div>
          <span className="text-sm font-medium">FleetGraph</span>
          {statusData?.enabled && (
            <span className="h-2 w-2 rounded-full bg-green-500" title="Active" />
          )}
        </div>
        <button onClick={onClose} className="text-muted hover:text-foreground" aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        <button
          onClick={() => setActiveTab('chat')}
          className={cn(
            'flex-1 py-2 text-xs font-medium transition-colors',
            activeTab === 'chat' ? 'border-b-2 border-accent text-accent' : 'text-muted hover:text-foreground'
          )}
        >
          Chat
        </button>
        <button
          onClick={() => setActiveTab('findings')}
          className={cn(
            'relative flex-1 py-2 text-xs font-medium transition-colors',
            activeTab === 'findings' ? 'border-b-2 border-accent text-accent' : 'text-muted hover:text-foreground'
          )}
        >
          Findings
          {pendingCount > 0 && (
            <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] text-white">
              {pendingCount}
            </span>
          )}
        </button>
      </div>

      {/* Content */}
      {activeTab === 'chat' ? (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <div className="text-center text-sm text-muted py-8">
                <p className="mb-2">Ask FleetGraph about your project</p>
                <div className="space-y-1 text-xs">
                  <p className="cursor-pointer hover:text-foreground" onClick={() => setInput("What's stale?")}>
                    "What's stale?"
                  </p>
                  <p className="cursor-pointer hover:text-foreground" onClick={() => setInput("How is this project doing?")}>
                    "How is this project doing?"
                  </p>
                  <p className="cursor-pointer hover:text-foreground" onClick={() => setInput("What should I focus on today?")}>
                    "What should I focus on today?"
                  </p>
                </div>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={cn('text-sm', msg.role === 'user' ? 'text-right' : '')}>
                <div className={cn(
                  'inline-block max-w-[85%] rounded-lg px-3 py-2',
                  msg.role === 'user'
                    ? 'bg-accent text-white'
                    : 'bg-border/50 text-foreground'
                )}>
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            ))}
            {chatMutation.isPending && (
              <div className="text-sm">
                <div className="inline-block rounded-lg bg-border/50 px-3 py-2 text-muted">
                  Thinking...
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-border p-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSend()}
                placeholder="Ask FleetGraph..."
                className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none"
                disabled={chatMutation.isPending}
              />
              <button
                onClick={handleSend}
                disabled={chatMutation.isPending || !input.trim()}
                className="rounded-md bg-accent px-3 py-2 text-sm text-white hover:bg-accent/90 disabled:opacity-50"
              >
                Send
              </button>
            </div>
          </div>
        </>
      ) : (
        /* Findings tab */
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {findings.length === 0 && (
            <div className="text-center text-sm text-muted py-8">
              No pending findings
            </div>
          )}
          {findings.map(finding => (
            <div key={finding.id} className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className={cn(
                  'inline-block rounded px-1.5 py-0.5 text-[10px] font-medium uppercase',
                  finding.severity === 'high' ? 'bg-red-500/20 text-red-400' :
                  finding.severity === 'medium' ? 'bg-orange-500/20 text-orange-400' :
                  'bg-yellow-500/20 text-yellow-400'
                )}>
                  {finding.severity}
                </span>
                <span className="text-xs text-muted">{finding.finding_type.replace('_', ' ')}</span>
              </div>
              <p className="text-sm">{finding.summary}</p>
              {finding.proposed_action && (
                <p className="text-xs text-muted italic">Suggestion: {finding.proposed_action}</p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => approveMutation.mutate(finding.id)}
                  disabled={approveMutation.isPending}
                  className="rounded-md bg-green-600/20 px-2.5 py-1 text-xs text-green-400 hover:bg-green-600/30"
                >
                  Approve
                </button>
                <button
                  onClick={() => dismissMutation.mutate(finding.id)}
                  disabled={dismissMutation.isPending}
                  className="rounded-md bg-border px-2.5 py-1 text-xs text-muted hover:bg-border/80"
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FleetGraphIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 2L14 5.5V10.5L8 14L2 10.5V5.5L8 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
      <path d="M8 6L11 7.75V11.25L8 13L5 11.25V7.75L8 6Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" opacity="0.5"/>
      <circle cx="8" cy="8" r="1.5" fill="currentColor"/>
    </svg>
  );
}

export { FleetGraphIcon };
