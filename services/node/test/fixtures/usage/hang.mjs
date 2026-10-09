// An owned test child that never prints a complete reading and ignores graceful termination.
process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
