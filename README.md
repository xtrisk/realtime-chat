# 🚀 Full Stack MERN Chat Application

This repository showcases my learning journey as I explore full‑stack web development with the MERN stack (MongoDB, Express.js, React, Node.js). The main focus is on building a scalable, real‑time chat application that incorporates essential features like authentication, real‑time communication, and a clean, responsive user interface.

---

## 📚 About This Repository

Each project and exercise in this repository is created with a focus on industry best practices and scalable architecture. The chat application specifically demonstrates how to integrate a Node.js/Express API with a MongoDB database, a React front-end powered by Vite and Tailwind CSS, and real‑time messaging using Socket.IO. Along the way, I dive into key concepts like environment configuration, state management, and creating a responsive UI.

## 🛠️ Tech Stack

The core technologies used in this repository include:

- **Node.js** – JavaScript runtime for server‑side development
- **Express.js** – Fast, minimalist web framework for building REST APIs
- **MongoDB** – NoSQL database for flexible, scalable data storage
- **React** – Component‑based UI library for building interactive interfaces
- **Socket.IO** – Real‑time, bi‑directional communication library for Node and the browser
- **Vite** – Lightning‑fast build tool and development server for modern JavaScript projects
- **Tailwind CSS** – Utility‑first CSS framework for rapid UI development

## ⚙️ Features

- **Global and private chat** – Users can participate in a public chat room or send direct messages to other users.
- **Message requests** – When a new user sends a private message, the recipient sees a message request in a dedicated tab. Upon accepting the request, the conversation moves into the recent chats list.
- **Real‑time updates** – Messages and notifications are delivered instantly via WebSocket connections.
- **User authentication** – JWT‑based authentication ensures that only registered users can send and receive messages.
- **Responsive design** – Built with Tailwind CSS to provide a polished experience on both mobile and desktop screens.

## 🚀 Getting Started

### Prerequisites

Before running the project you will need:

- [Node.js](https://nodejs.org/) and npm installed
- A running instance of MongoDB (local or cloud hosted)

### Installation

1. **Clone the repository** and navigate into the project directory.

2. **Install server dependencies:**

   ```bash
   cd server
   npm install
   ```

3. **Install client dependencies:**

   ```bash
   cd ../client
   npm install
   ```

4. **Configure environment variables:** Create a `.env` file in the `server` directory with the following keys:

   ```env
   MONGO_URI=your-mongodb-connection-string
   JWT_SECRET=your-jwt-secret
   CLIENT_URL=http://localhost:5173
   ```

### Running the Application

The backend and frontend should run simultaneously.

1. **Start the Express backend:**

   ```bash
   cd server
   npm run start
   ```

   The API will be available at `http://localhost:5000`.

2. **Start the React frontend (in a new terminal):**

   ```bash
   cd client
   npm run dev
   ```

   The client will be available at `http://localhost:5173`.

> **Note:** Both servers must be running for the full application to function correctly.

## 📂 Available Scripts

Each part of the repository exposes a set of npm scripts for development and production:

### Server

- `npm run start` – Start the Express server.
- `npm run dev` – Start the server with nodemon for automatic restarts during development.

### Client

- `npm run dev` – Start the Vite development server.
- `npm run build` – Build the React application for production.
- `npm run preview` – Preview the production build locally.

### Video
https://vimeo.com/1179967793?share=copy&fl=sv&fe=ci


### AI Usage

Deepseek AI was used whenever I faced complex error and coudlnt find that error by myself. 
