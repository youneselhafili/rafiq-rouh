const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
};

function timestamp(): string {
    return new Date().toLocaleString('ar-EG', {
        timeZone: 'Africa/Algiers',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

export const logger = {
    info: (message: string, ...args: unknown[]) => {
        console.log(`${colors.cyan}[${timestamp()}] [INFO]${colors.reset} ${message}`, ...args);
    },

    success: (message: string, ...args: unknown[]) => {
        console.log(`${colors.green}[${timestamp()}] [SUCCESS]${colors.reset} ${message}`, ...args);
    },

    warn: (message: string, ...args: unknown[]) => {
        console.warn(`${colors.yellow}[${timestamp()}] [WARN]${colors.reset} ${message}`, ...args);
    },

    error: (message: string, ...args: unknown[]) => {
        console.error(`${colors.red}[${timestamp()}] [ERROR]${colors.reset} ${message}`, ...args);
    },

    debug: (message: string, ...args: unknown[]) => {
        if (process.env.NODE_ENV === 'development') {
            console.log(`${colors.magenta}[${timestamp()}] [DEBUG]${colors.reset} ${message}`, ...args);
        }
    },

    command: (commandName: string, userId: string, guildId: string | null) => {
        console.log(
            `${colors.blue}[${timestamp()}] [CMD]${colors.reset} /${commandName} by ${userId} in ${guildId ?? 'DM'}`
        );
    },
};
