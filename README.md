# Imirae Incheon Back Office

A comprehensive full-stack enterprise management system for care service operations, built with modern web technologies and clean architecture principles.

## 📋 Project Overview

This back-office management system is designed for Imirae Incheon to streamline operations related to client management, employee scheduling, contract processing, and financial administration. The application provides a centralized platform for managing care services, voucher pricing, message templates, and electronic document signing integration.

## ✨ Key Features

### Core Functionality
- **Client Management**: Complete CRUD operations for client records and relationship tracking
- **Employee Management**: Staff scheduling, information management, and work assignment
- **Contract Processing**: Electronic form signing integration via eformsign API
- **Message Templates**: Pre-configured message templates for various communication scenarios:
  - Welcome/Greeting messages
  - Service information
  - Price information
  - Contract creation
  - Reminders
  - Surveys
  - Thank you messages
- **Financial Management**: Bank account information and voucher pricing administration
- **Authentication & Authorization**: Secure JWT-based authentication with Kakao OAuth integration
- **Multi-language Support**: Korean and English language support

### Technical Highlights
- Clean Architecture implementation with clear separation of concerns
- RESTful API design following industry best practices
- Type-safe development with TypeScript across the entire stack
- Real-time data fetching with React Query
- Responsive Material-UI design system
- Database management with Prisma ORM

## 🛠 Technology Stack

### Backend
- **Framework**: NestJS 10.x
- **Language**: TypeScript 5.x
- **ORM**: Prisma 6.x
- **Authentication**: 
  - JWT (JSON Web Tokens)
  - Passport.js
  - Kakao OAuth
- **Validation**: class-validator, class-transformer
- **Testing**: Jest, ts-jest

### Frontend
- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript 5.x
- **UI Library**: Material-UI (MUI) 7.x
- **State Management**: Zustand
- **Data Fetching**: TanStack React Query (React Query v5)
- **Styling**: 
  - Emotion (CSS-in-JS)
  - Tailwind CSS 4.x
- **Date Handling**: Day.js
- **Internationalization**: next-intl
- **HTTP Client**: Axios

## 🏗 Architecture

### Backend Architecture (Clean Architecture)

```
backend/
├── domain/              # Business logic and entities
│   ├── entities/       # Core business entities
│   ├── repositories/   # Repository interfaces
│   └── value-objects/  # Value objects (Email, Money, PhoneNumber)
├── application/        # Application business rules
│   ├── dto/           # Data Transfer Objects
│   ├── services/      # Application services
│   └── usecases/      # Use case implementations
├── infrastructure/    # External concerns
│   ├── auth/         # Authentication strategies
│   └── database/     # Prisma setup and implementations
└── interface/        # External interface layer
    ├── controllers/  # REST API controllers
    └── dto/         # API request/response DTOs
```

**Key Design Patterns**:
- **Repository Pattern**: Abstracts data access logic
- **Use Case Pattern**: Encapsulates business operations
- **Dependency Injection**: Leverages NestJS DI container
- **DTO Pattern**: Ensures data validation and transformation

### Frontend Architecture

```
frontend/
├── app/                    # Next.js App Router
│   ├── (components)/      # Feature components
│   │   ├── dashboard/    # Dashboard widgets
│   │   ├── messages/     # Message template forms
│   │   └── nav-bar/      # Navigation components
│   ├── lib/              # Utility functions and configs
│   ├── store/            # Zustand state management
│   └── middleware.ts     # Next.js middleware
├── services/             # API service layer
└── texts/               # i18n translation files
```

## 🚀 Getting Started

### Prerequisites
- Node.js 20.x or higher
- npm, yarn, pnpm, or bun
- PostgreSQL (or your configured database)

### Installation

1. **Clone the repository**
```bash
git clone <repository-url>
cd imirae-incheon-back-office
```

2. **Backend Setup**
```bash
cd backend
npm install

# Configure environment variables
cp .env.example .env
# Edit .env with your database credentials and JWT secrets

# Run database migrations
npx prisma migrate dev

# Generate Prisma client
npx prisma generate

# Start development server
npm run start:dev
```

The backend API will be available at `http://localhost:3001` (or your configured port)

3. **Frontend Setup**
```bash
cd frontend
npm install

# Configure environment variables
cp .env.example .env.local
# Edit .env.local with your API endpoint

# Start development server
npm run dev
```

The frontend application will be available at `http://localhost:3000`

## 📝 Available Scripts

### Backend
- `npm run start:dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm run start:prod` - Start production server
- `npm run test` - Run unit tests
- `npm run test:watch` - Run tests in watch mode

### Frontend
- `npm run dev` - Start Next.js development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint

## 🗄 Database

The application uses Prisma as the ORM, supporting multiple database providers. The schema includes:

- Users & Authentication
- Clients
- Employees & Schedules
- Bank Account Information
- Voucher Price Information
- Messages & Templates

To view and manage the database:
```bash
cd backend
npx prisma studio
```

## 🔐 Authentication Flow

1. User initiates login via Kakao OAuth
2. Backend validates OAuth token with Kakao API
3. Backend generates JWT access token
4. Frontend stores JWT in cookies
5. Subsequent requests include JWT in Authorization header
6. JWT Guard validates tokens on protected routes

## 🌐 API Documentation

The backend exposes RESTful APIs for:
- `/auth` - Authentication endpoints
- `/users` - User management
- `/clients` - Client management
- `/employees` - Employee management
- `/employee-schedules` - Schedule management
- `/messages` - Message template management
- `/bank-account-info` - Bank account management
- `/voucher-price-info` - Voucher pricing management

## 🧪 Testing

```bash
# Backend unit tests
cd backend
npm run test

# Backend test coverage
npm run test:cov
```

## 📦 Modules

### Backend Modules
- **Auth Module**: JWT & Kakao OAuth authentication
- **User Module**: User account management
- **Client Module**: Client information management
- **Employee Module**: Staff management
- **Employee Schedule Module**: Work schedule coordination
- **Message Module**: Template-based messaging system
- **Bank Account Info Module**: Financial account management
- **Voucher Price Info Module**: Service pricing management

### Frontend Features
- **Dashboard**: Overview and quick access to key metrics
- **Message Management**: Create and manage message templates
- **User Interface**: Responsive Material Design components
- **Form Handling**: Dynamic form generation with validation
- **Multi-language**: Seamless language switching

## 🚢 Deployment

### Backend Deployment
```bash
cd backend
npm run build
npm run start:prod
```

### Frontend Deployment
The easiest way to deploy the Next.js app is using [Vercel](https://vercel.com):

```bash
cd frontend
npm run build
# Deploy to Vercel or your preferred hosting platform
```

For detailed Next.js deployment options, see the [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying).

## 🤝 Development Workflow

1. Create feature branch from `main`
2. Implement features following clean architecture principles
3. Write unit tests for new functionality
4. Ensure type safety with TypeScript
5. Test integration with both frontend and backend
6. Submit pull request for code review

## 📚 Project Highlights for Recruiters

### Technical Proficiency Demonstrated
- **Full-Stack Development**: Comprehensive implementation from database to UI
- **Modern TypeScript**: Advanced TypeScript usage across the entire stack
- **Clean Architecture**: SOLID principles and separation of concerns
- **Security**: JWT authentication, OAuth integration, secure cookie handling
- **Testing**: Jest unit testing setup and infrastructure
- **API Design**: RESTful API design with proper validation and error handling
- **Database Design**: Normalized schema with Prisma ORM
- **State Management**: React Query for server state, Zustand for client state
- **Performance**: Optimized with Next.js App Router and React Server Components
- **Internationalization**: Multi-language support implementation
- **UI/UX**: Material Design implementation with responsive layouts

### Code Quality Features
- Type-safe development with TypeScript
- Consistent code organization and project structure
- Dependency injection and inversion of control
- Validation at multiple layers (DTOs, entities, value objects)
- Error handling and exception filters
- Modular and maintainable codebase

## 📄 License

This project is private and unlicensed.

## 👥 Contact

For questions or inquiries about this project, please contact the development team.

---

Built with ❤️ using NestJS, Next.js, and modern web technologies.
