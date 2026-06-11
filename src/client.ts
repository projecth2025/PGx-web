import './styles.css'
import { initTheme } from '@/lib/theme'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { getRouter } from './router'

initTheme()

const router = getRouter()

const rootElement = document.getElementById('root')
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement)
  root.render(React.createElement(RouterProvider, { router }))
}
