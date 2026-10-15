# Backups of the cloud (RNF-14, RNF-15, DEC-045): mysqldump from the same MySQL version and
# restic (encrypted, deduplicated) to an S3-compatible bucket in a Swiss region.
FROM mysql:8.4

ARG RESTIC_VERSION=0.17.3
RUN microdnf install -y bzip2 tar gzip && microdnf clean all \
 && curl -fsSL -o /tmp/restic.bz2 \
      "https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_linux_amd64.bz2" \
 && bunzip2 /tmp/restic.bz2 && install -m 0755 /tmp/restic /usr/local/bin/restic && rm -f /tmp/restic

COPY backup.sh restore.sh restore-test.sh lib.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/*.sh

# Not the MySQL server: this container only runs the backup loop.
ENTRYPOINT []
CMD ["backup.sh"]
