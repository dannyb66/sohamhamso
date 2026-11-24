# YouTube support kit: @sohamhamso

Copy-paste templates for asking viewers to support the project. This is part of the [donations plan](DONATIONS.md).

Channel status (checked in YouTube Studio, 23 Nov 2026): **971 subscribers**, about 326 watch hours in the last 28 days.
On the YPP page, "Base terms" is done, **AdSense isn't linked** and **review hasn't started**.
Super Thanks only becomes available after YPP acceptance (see section 7 and DONATIONS.md §6).

Every link points to `sohamhamso.org/donate`, never to a raw payment link, because:

- one link works for both India (UPI) and the rest of the world (card), since the page picks the right tab;
- if payment settings change, old videos still work;
- `?src=` tags tell you which surface the money came from (it's sent to Stripe as `client_reference_id`).

| Surface | Link |
|---|---|
| Video description | `https://sohamhamso.org/donate?src=yt` |
| Pinned comment | `https://sohamhamso.org/donate?src=yt-pin` |
| On-screen QR | `https://sohamhamso.org/donate?src=yt-qr` |
| Channel links / About | `https://sohamhamso.org/donate?src=yt-about` |
| Community posts | `https://sohamhamso.org/donate?src=yt-post` |

---

## 1. Description block (put it in the first 2–3 lines, above "…more")

Only the first ~2 lines show before "…more", so the link goes there. Set it once in
**Studio → Settings → Upload defaults → Description** so every new upload starts with it, then paste it into older videos too.

**English-first videos**
```
📖 Read every verse with word-by-word meaning: https://sohamhamso.org
🙏 Support this free, ad-free project (UPI in India · card worldwide): https://sohamhamso.org/donate?src=yt
```

**Hindi-first videos**
```
📖 हर श्लोक शब्दार्थ सहित पढ़ें: https://sohamhamso.org
🙏 इस निःशुल्क, विज्ञापन-रहित प्रयास को सहयोग दें (भारत में UPI · विदेश से कार्ड): https://sohamhamso.org/donate?src=yt
```

Optional footer, at the end of the description:
```
sohamhamso is a non-profit reader for the Tantric canon. Contributions are voluntary, one-time, and not tax-deductible.
```

## 2. Pinned comment

```
🙏 If these recitations help your practice, you can support the project with a one-time contribution (UPI in India · card worldwide):
https://sohamhamso.org/donate?src=yt-pin
Full text with word-by-word meaning: https://sohamhamso.org
```
Hindi:
```
🙏 यदि ये पाठ आपकी साधना में सहायक हैं, तो एक बार का सहयोग दे सकते हैं (भारत में UPI · विदेश से कार्ड):
https://sohamhamso.org/donate?src=yt-pin
शब्दार्थ सहित पूरा पाठ: https://sohamhamso.org
```

## 3. Shorts

Links in Shorts descriptions **aren't clickable**. Instead:
- pin the comment above on every Short;
- use **Related video** to point each Short at its full-length video, where the description link is clickable;
- don't put a QR in Shorts: they're too short to scan.

## 4. On-screen QR and outro (long-form only)

- Make the QR from `https://sohamhamso.org/donate?src=yt-qr`. Use a URL QR, **not** a payment QR (reasons above).
- Keep it on screen for **8–10 seconds** in the outro, at least 25% of the frame height, as a dark QR on a light background.
- Leave the end-screen area clear if you'll use end-screen elements later.

**Spoken script (Hindi, ~10 s)**
> यदि यह पाठ आपको उपयोगी लगा, तो sohamhamso.org पर पूरा ग्रंथ शब्दार्थ सहित पढ़ें। इस निःशुल्क प्रयास को सहयोग देना चाहें तो स्क्रीन पर दिया QR स्कैन करें, या विवरण में दिया लिंक खोलें।

**Spoken script (English, ~10 s)**
> If this recitation helped, the full text with word-by-word meaning is free at sohamhamso.org. To support the project, scan the code on screen or use the link in the description.

Keep it to one short ask at the end. Mid-recitation asks interrupt the practice and lead to drop-off.

## 5. Channel header and About links

**Studio → Customization → Profile → Links**
1. `Read: sohamhamso.org` → `https://sohamhamso.org`
2. `Support (one-time)` → `https://sohamhamso.org/donate?src=yt-about`

Add one line to the channel description:
```
Free texts with word-by-word meaning at sohamhamso.org · Support (one-time, no subscriptions): sohamhamso.org/donate
```

## 6. Community post (no more than once a quarter, or when there's a milestone)

```
New on sohamhamso.org: [what shipped, e.g. "Vijñāna Bhairava now in Tamil and Kannada"].
Everything stays free and ad-free. If you'd like to help with translation and hosting costs, one-time contributions are welcome (UPI in India, card worldwide):
https://sohamhamso.org/donate?src=yt-post
```

## 7. Super Thanks

Setup, payee choice, tax forms and the review risk from the "inauthentic content" policy are covered in [DONATIONS.md §6](DONATIONS.md#6-youtube-partner-program-needed-for-super-thanks). Once you're accepted:
- Earn → Supers → turn on **Super Thanks**. Leave channel memberships off (they're a subscription).
- Super Thanks isn't available on videos with Content ID claims, or on age-restricted, made-for-kids or comments-off videos.
- YouTube keeps 30%, so the main ask in every video stays the `/donate` link.

**Thank-you reply (public; reply to every one):**
```
🙏 धन्यवाद! Thank you for supporting sohamhamso. It keeps the texts free for everyone.
```

## 8. Apply to existing videos

1. Don't use Studio's native bulk edit (Content → select → Edit → Description) for this. As far as I can tell it sets one description on every selected video rather than adding to each, which would wipe each video's own text. Test it on one unlisted video first if you want to be sure. Instead, paste the block by hand into the **top 10 videos by views** (Analytics → Content), which covers most traffic. For the rest, a short YouTube Data API script (`videos.update`, prepending the block) can do it later.
2. Pin the comment on the same 10.
3. Add the QR outro only to new uploads.
