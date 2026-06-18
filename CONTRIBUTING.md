# Contributing to CollabFlow

First off, thank you for considering contributing to CollabFlow! It's people like you that make CollabFlow such a great tool for project managers and engineers.

## 1. Where do I go from here?

If you've noticed a bug or have a feature request, please make sure to check our [Issues](../../issues) to see if someone else in the community has already created a ticket. If not, go ahead and [make one](../../issues/new)!

## 2. Setting up your environment

CollabFlow is heavily containerized using Docker to ensure environment parity across all operating systems.

1. **Fork & Clone**: Fork the repository and clone your fork locally.
2. **Environment Variables**: Copy the `.env.example` file to `.env`.
   ```bash
   cp .env.example .env
   ```
3. **Build the Containers**:
   ```bash
   docker compose up --build
   ```
4. **Run Migrations**:
   ```bash
   docker compose exec web python manage.py migrate
   ```

You can now access the local development server at `http://localhost:8001`.

## 3. Testing

Before submitting a Pull Request, ensure that all tests pass. CollabFlow uses `pytest` alongside Django Channels testing utilities.

Run the test suite via Docker:
```bash
docker compose exec web pytest -v
```

## 4. Pull Request Process

1. Create a feature branch (`git checkout -b feature/AmazingFeature`).
2. Make your changes.
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`).
4. Push to the branch (`git push origin feature/AmazingFeature`).
5. Open a Pull Request!

### PR Requirements
- **Pass all tests**: GitHub Actions will automatically run the test suite.
- **Self-Documenting Code**: Do not include excessive comments. Use explicit typing and semantic variable naming.
- **Separation of Concerns**: Keep business logic in `services.py`, routing in `consumers.py`, and pure relations in `models.py`.
