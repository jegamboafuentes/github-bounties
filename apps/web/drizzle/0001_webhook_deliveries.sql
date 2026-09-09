CREATE TABLE "webhook_deliveries" (
	"delivery_id" text PRIMARY KEY NOT NULL,
	"event" text NOT NULL,
	"action" text,
	"eligible" boolean,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
