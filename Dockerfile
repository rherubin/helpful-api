# Use the official Node.js 18 image
FROM node:18-alpine

# Install required packages for better-sqlite3
RUN apk add --no-cache python3 make g++ sqlite

# Set the working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy the rest of the application
COPY . .

# Expose the port
EXPOSE 9000

# Set environment variables
ENV NODE_ENV=production
ENV DATABASE_PATH=./helpful-db.sqlite

# Start the application
CMD ["npm", "start"]