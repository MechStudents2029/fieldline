"use client";

import { FormEvent, useMemo, useState } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { Button } from "@/components/ui/button";

export function StripePayForm({ publishableKey, clientSecret }: { publishableKey: string; clientSecret: string }) {
  const stripePromise = useMemo(() => loadStripe(publishableKey), [publishableKey]);
  return (
    <Elements stripe={stripePromise} options={{ clientSecret }}>
      <ConfirmPayment />
    </Elements>
  );
}

function ConfirmPayment() {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stripe || !elements) return;
    setPending(true);
    setError(null);
    const result = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: window.location.href.split("?")[0] },
    });
    if (result.error) {
      setError(result.error.message || "The payment did not go through.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" aria-busy={pending}>
      <PaymentElement />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {pending ? <p className="text-xs text-muted-foreground">Working…</p> : null}
      <Button type="submit" className="h-11" disabled={!stripe || pending}>
        Pay
      </Button>
      <p className="text-xs text-muted-foreground">
        Test mode
      </p>
    </form>
  );
}
