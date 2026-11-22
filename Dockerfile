# Use the official Node.js 24 image
FROM node:24-alpine

# Install required packages for MySQL connectivity / native modules
RUN apk add --no-cache python3 make g++

# Set the working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy the rest of the application
COPY . .

# Run as a non-root user
RUN addgroup -S app && adduser -S app -G app \
    && chown -R app:app /app
USER app

# Expose the port
EXPOSE 9000

# Start the application
CMD ["npm", "start"]
