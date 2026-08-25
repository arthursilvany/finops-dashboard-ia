# Static assets

Next.js serves everything in this directory at the site root.

The directory is kept in version control even while empty because the
production Dockerfile copies it into the runtime image; without it the build
fails at `COPY --from=builder /app/public ./public`.
