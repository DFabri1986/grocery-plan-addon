import React from "react";
import { createRoot } from "react-dom/client";
import GroceryPlanner from "./GroceryPlanner.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <GroceryPlanner />
  </React.StrictMode>
);
