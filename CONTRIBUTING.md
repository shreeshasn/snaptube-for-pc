# Contributing to NovaTube

Thank you for your interest in contributing to NovaTube! This document outlines general guidelines and procedures to make the contribution process simple and transparent.

---

## [.] How Can I Contribute?

### 1. Reporting Bugs
- Search the open issues database to check if the bug has already been reported.
- If it hasn't, open a new issue detailing:
  - System specs (OS, Node.js version, Rust toolchain target).
  - Clean step-by-step reproduction instructions.
  - Expected vs. actual outcomes.

### 2. Suggesting Features
- Open a feature request issue explaining the proposal and its utility.
- Discuss options with the maintainers before starting implementation.

### 3. Pull Requests
- Fork the repository.
- Create a feature branch (`git checkout -b feature/amazing-feature`).
- Ensure code style remains clean and aligned with existing code conventions.
- Verify changes compile successfully on local setups (`npm run dev:win`).
- Open a Pull Request pointing to the main branch.

---

## [.] Development Reference Checklist

- [+] Core Client Interface: React + Tailwind CSS + Framer Motion.
- [+] Background Canvas: Three.js shaders via `@react-three/fiber`.
- [+] Native App Layer: Tauri v2 (Rust backend).
- [+] Cloud Relay Server: Express server in `/relay-server`.
