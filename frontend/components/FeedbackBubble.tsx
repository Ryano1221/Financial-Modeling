"use client";

import { useState } from "react";

type FeedbackType = "question" | "issue" | null;

export function FeedbackBubble() {
  const [isOpen, setIsOpen] = useState(false);
  const [feedbackType, setFeedbackType] = useState<FeedbackType>(null);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async () => {
    if (!message.trim() || !feedbackType) return;

    setIsSubmitting(true);
    try {
      // Get current page path
      const page = typeof window !== "undefined" ? window.location.pathname : "";

      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: feedbackType,
          message: message.trim(),
          email: email.trim() || null,
          page,
        }),
      });

      if (response.ok) {
        setSubmitted(true);
        setTimeout(() => {
          setIsOpen(false);
          setFeedbackType(null);
          setMessage("");
          setEmail("");
          setSubmitted(false);
        }, 2000);
      }
    } catch (error) {
      console.error("Failed to submit feedback:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="fixed bottom-6 right-6 z-50">
        <div className="bg-cyan-500/20 border border-cyan-500/50 rounded-xl px-6 py-4 text-cyan-100 text-sm font-medium backdrop-blur-sm">
          Thanks! We&apos;ll be in touch.
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => {
          setIsOpen(!isOpen);
          if (isOpen) {
            setFeedbackType(null);
            setMessage("");
            setEmail("");
          }
        }}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-cyan-500 hover:bg-cyan-600 text-black font-bold px-4 py-2 rounded-full transition-all duration-200 shadow-lg hover:shadow-xl"
        title="Send us feedback"
      >
        <span className="text-lg">💬</span>
        <span className="hidden sm:inline">FEEDBACK</span>
      </button>

      {/* Expanded panel */}
      {isOpen && (
        <div className="fixed bottom-20 right-6 z-50 w-96 max-w-[calc(100vw-2rem)] bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl overflow-hidden backdrop-blur-sm">
          <div className="p-6 space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white font-syne uppercase tracking-tight">
                Share Feedback
              </h3>
              <button
                onClick={() => {
                  setIsOpen(false);
                  setFeedbackType(null);
                  setMessage("");
                  setEmail("");
                }}
                className="text-zinc-400 hover:text-white transition-colors text-2xl leading-none"
              >
                ✕
              </button>
            </div>

            {/* Type selection (shown initially) */}
            {!feedbackType ? (
              <div className="space-y-3">
                <button
                  onClick={() => setFeedbackType("question")}
                  className="w-full p-4 border border-zinc-700 bg-zinc-800/50 hover:bg-zinc-700/50 rounded-lg text-left transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xl">💬</span>
                    <div>
                      <p className="font-medium text-white group-hover:text-cyan-100">
                        Ask a question
                      </p>
                      <p className="text-xs text-zinc-400 mt-1">
                        Help with features or usage
                      </p>
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => setFeedbackType("issue")}
                  className="w-full p-4 border border-zinc-700 bg-zinc-800/50 hover:bg-zinc-700/50 rounded-lg text-left transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xl">🐛</span>
                    <div>
                      <p className="font-medium text-white group-hover:text-cyan-100">
                        Report an issue
                      </p>
                      <p className="text-xs text-zinc-400 mt-1">
                        Something&apos;s not working right
                      </p>
                    </div>
                  </div>
                </button>
              </div>
            ) : (
              // Form (shown after type selected)
              <div className="space-y-4">
                <button
                  onClick={() => setFeedbackType(null)}
                  className="text-xs text-zinc-400 hover:text-zinc-300 transition-colors"
                >
                  ← BACK
                </button>

                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="What's on your mind?"
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 resize-none"
                  rows={4}
                />

                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Your email (optional)"
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20"
                />

                <button
                  onClick={handleSubmit}
                  disabled={!message.trim() || isSubmitting}
                  className="w-full flex items-center justify-center gap-2 bg-cyan-500 hover:bg-cyan-600 disabled:bg-zinc-700 disabled:cursor-not-allowed text-black font-bold py-2 rounded-lg transition-colors"
                >
                  <span>➤</span>
                  <span>SEND FEEDBACK</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
