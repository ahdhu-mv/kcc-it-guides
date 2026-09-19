FROM alpine:3.20
RUN apk add --no-cache git openssh-client
WORKDIR /repo
COPY sync.sh /sync.sh
RUN chmod +x /sync.sh
ENTRYPOINT ["/sync.sh"]
