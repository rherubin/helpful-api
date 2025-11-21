# Use the official Node.js 18 image
FROM node:18-alpine

# Install required packages for MySQL connectivity
RUN apk add --no-cache python3 make g++

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

# Start the application
CMD ["npm", "start"]