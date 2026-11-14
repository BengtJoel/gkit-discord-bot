import { z } from "zod";

/** Schemas for designed messages. Kept free of other imports so settings.ts can use them without an import cycle. */

const hex = z.string().regex(/^#[0-9a-f]{6}$/i);
const httpUrl = z.union([z.literal(""), z.url({ protocol: /^https?$/ }).max(2000)]);

export const embedSchema = z
  .object({
    enabled: z.boolean().default(false),
    title: z.string().max(256).default(""),
    url: httpUrl.default(""),
    description: z.string().max(4000).default(""),
    /** null = the server's brand colour */
    color: hex.nullable().default(null),
    /** Small line above the title */
    author: z.enum(["none", "member", "server"]).default("none"),
    /** Small picture top-right */
    thumbnail: z.enum(["none", "member", "server"]).default("none"),
    fields: z
      .array(z.object({ name: z.string().min(1).max(256), value: z.string().min(1).max(1024), inline: z.boolean().default(false) }))
      .max(25)
      .default([]),
    footer: z.string().max(2048).default(""),
    timestamp: z.boolean().default(false),
  })
  .prefault({});

/** Uploaded image (mediaId) or a link to one. Inside an embed it becomes the embed's big image. */
export const cardSchema = z
  .object({
    /** Draw the member's avatar and name on the image (welcome cards) */
    enabled: z.boolean().default(false),
    layout: z.enum(["center", "left"]).default("center"),
    /** Empty = the localized default ("Welcome {displayname}!") */
    title: z.string().max(100).default(""),
    subtitle: z.string().max(150).default(""),
    textColor: hex.default("#ffffff"),
    /** null = the server's brand colour */
    accentColor: hex.nullable().default(null),
    overlay: z.number().int().min(0).max(90).default(35),
  })
  .prefault({});

export const imageSchema = z
  .object({
    mediaId: z.number().int().positive().nullable().default(null),
    url: httpUrl.default(""),
    card: cardSchema,
  })
  .prefault({});

export const designFields = {
  message: z.string().max(2000).default(""),
  embed: embedSchema,
  image: imageSchema,
};
export const designSchema = z.object(designFields);
export type Design = z.infer<typeof designSchema>;
