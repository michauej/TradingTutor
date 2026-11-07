import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Matches `dotnet run --launch-profile http` (http://localhost:5014).
      // For the https profile instead, target https://localhost:7126 and set
      // secure: false so the local ASP.NET Core dev certificate is accepted.
      '/api': {
        target: 'http://localhost:5014',
        changeOrigin: true,
      },
    },
  },
})
