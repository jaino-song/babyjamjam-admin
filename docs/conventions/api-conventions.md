# API Conventions

## Architecture: Proxy Pattern

All client-side API calls must route through Next.js API routes. **Never call the NestJS backend directly from client components.**

```
Client Component → Next.js API Route (/api/*) → NestJS Backend
```

### Why This Pattern?
- Centralized authentication token management
- CORS handling at the edge
- Request/response transformation layer
- Security: backend credentials never exposed to client

---

## Next.js API Routes

### Authentication Token Extraction

```typescript
import { NextRequest, NextResponse } from "next/server";

function getAuthToken(request: NextRequest): string | null {
    return request.cookies.get("auth_token")?.value || null;
}

function getAuthHeaders(token: string | null): Record<string, string> {
    return token ? { Authorization: `Bearer ${token}` } : {};
}
```

### Basic GET Endpoint Pattern

```typescript
import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/app/lib/axios/server";

export async function GET(request: NextRequest) {
    const token = getAuthToken(request);
    
    if (!token) {
        return NextResponse.json(
            { error: "Unauthorized" },
            { status: 401 }
        );
    }

    try {
        const response = await serverAPIClient.get(
            "/clients",
            {
                headers: getAuthHeaders(token),
                params: Object.fromEntries(request.nextUrl.searchParams),
            }
        );
        
        return NextResponse.json(response.data);
    } catch (error) {
        // Handle backend errors
        return NextResponse.json(
            { error: "Failed to fetch clients" },
            { status: 500 }
        );
    }
}
```

### Dynamic Route Parameters

Use `Promise<>` pattern for dynamic segments:

```typescript
type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
    const { id } = await params;
    const token = getAuthToken(request);
    
    if (!token) {
        return NextResponse.json(
            { error: "Unauthorized" },
            { status: 401 }
        );
    }

    try {
        const response = await serverAPIClient.get(
            `/clients/${id}`,
            { headers: getAuthHeaders(token) }
        );
        
        return NextResponse.json(response.data);
    } catch (error) {
        return NextResponse.json(
            { error: "Client not found" },
            { status: 404 }
        );
    }
}
```

### POST Endpoint Pattern

```typescript
export async function POST(request: NextRequest) {
    const token = getAuthToken(request);
    
    if (!token) {
        return NextResponse.json(
            { error: "Unauthorized" },
            { status: 401 }
        );
    }

    try {
        const body = await request.json();
        
        const response = await serverAPIClient.post(
            "/clients",
            body,
            { headers: getAuthHeaders(token) }
        );
        
        return NextResponse.json(response.data, { status: 201 });
    } catch (error) {
        return NextResponse.json(
            { error: "Failed to create client" },
            { status: 400 }
        );
    }
}
```

### PATCH Endpoint Pattern

```typescript
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const { id } = await params;
    const token = getAuthToken(request);
    
    if (!token) {
        return NextResponse.json(
            { error: "Unauthorized" },
            { status: 401 }
        );
    }

    try {
        const body = await request.json();
        
        const response = await serverAPIClient.patch(
            `/clients/${id}`,
            body,
            { headers: getAuthHeaders(token) }
        );
        
        return NextResponse.json(response.data);
    } catch (error) {
        return NextResponse.json(
            { error: "Failed to update client" },
            { status: 400 }
        );
    }
}
```

### DELETE Endpoint Pattern

```typescript
export async function DELETE(request: NextRequest, { params }: RouteParams) {
    const { id } = await params;
    const token = getAuthToken(request);
    
    if (!token) {
        return NextResponse.json(
            { error: "Unauthorized" },
            { status: 401 }
        );
    }

    try {
        await serverAPIClient.delete(
            `/clients/${id}`,
            { headers: getAuthHeaders(token) }
        );
        
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json(
            { error: "Failed to delete client" },
            { status: 404 }
        );
    }
}
```

---

## NestJS Backend Controllers

### Route Naming Conventions

- **Resource collections**: Use plural nouns
  - ✅ `/clients`, `/employees`, `/projects`
  - ❌ `/client`, `/employee`, `/project`

- **Nested resources**: Follow REST hierarchy
  - `/clients/:id/employees` - employees of a specific client
  - `/projects/:id/tasks` - tasks in a project

### HTTP Methods

| Method | Purpose | Status Code |
|--------|---------|-------------|
| GET | Retrieve list or single resource | 200 |
| POST | Create new resource | 201 |
| PATCH | Partial update | 200 |
| DELETE | Remove resource | 200 |

### Custom Actions

For non-CRUD operations, use `PATCH :id/{action}`:

```typescript
// Example: Terminate a client
PATCH /clients/:id/terminate

// Example: Activate an employee
PATCH /employees/:id/activate

// Example: Archive a project
PATCH /projects/:id/archive
```

### Controller Example

```typescript
import { Controller, Get, Post, Patch, Delete, UseGuards, Param, Body, Query } from '@nestjs/common';
import { JwtGuard } from '@/infrastructure/guards/jwt.guard';

@Controller('clients')
@UseGuards(JwtGuard)
export class ClientController {
    constructor(private readonly clientService: ClientService) {}

    @Get()
    async list(@Query('page') page = 1, @Query('limit') limit = 10) {
        return this.clientService.list(page, limit);
    }

    @Get(':id')
    async getById(@Param('id') id: string) {
        return this.clientService.getById(id);
    }

    @Post()
    async create(@Body() createClientDto: CreateClientDto) {
        return this.clientService.create(createClientDto);
    }

    @Patch(':id')
    async update(@Param('id') id: string, @Body() updateClientDto: UpdateClientDto) {
        return this.clientService.update(id, updateClientDto);
    }

    @Patch(':id/terminate')
    async terminate(@Param('id') id: string) {
        return this.clientService.terminate(id);
    }

    @Delete(':id')
    async delete(@Param('id') id: string) {
        return this.clientService.delete(id);
    }
}
```

---

## Pagination

### Query Parameters

```
GET /clients?page=1&limit=10&search=term
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | 1 | Page number (1-indexed) |
| `limit` | number | 10 | Items per page |
| `search` | string | - | Search term (optional) |
| `sortBy` | string | - | Sort field (optional) |
| `order` | 'asc' \| 'desc' | 'asc' | Sort order (optional) |

### Response Format

```typescript
interface PaginatedResult<T> {
    data: T[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}
```

### Example Response

```json
{
    "data": [
        { "id": "1", "name": "Client A" },
        { "id": "2", "name": "Client B" }
    ],
    "total": 42,
    "page": 1,
    "limit": 10,
    "totalPages": 5
}
```

### Implementation in Service

```typescript
async list(page: number, limit: number, search?: string): Promise<PaginatedResult<Client>> {
    const skip = (page - 1) * limit;
    
    const where = search ? { name: { contains: search } } : {};
    
    const [data, total] = await Promise.all([
        this.prisma.client.findMany({
            where,
            skip,
            take: limit,
            orderBy: { createdAt: 'desc' },
        }),
        this.prisma.client.count({ where }),
    ]);

    return {
        data,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
    };
}
```

---

## Error Handling

### Prisma Error Mapping

Errors from Prisma are caught and mapped to HTTP status codes:

| Prisma Code | HTTP Status | Meaning | Example |
|-------------|-------------|---------|---------|
| P2002 | 409 Conflict | Unique constraint violation | Duplicate email |
| P2003 | 400 Bad Request | Foreign key constraint | Invalid client ID |
| P2025 | 404 Not Found | Record not found | Client doesn't exist |
| P2000 | 400 Bad Request | Value too long | String exceeds max length |

### Error Response Format

```json
{
    "statusCode": 409,
    "code": "UNIQUE_CONSTRAINT_FAILED",
    "error": "A client with this email already exists",
    "field": "email"
}
```

### Exception Filter Implementation

```typescript
import { ExceptionFilter, Catch, ArgumentsHost, HttpStatus } from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

@Catch(PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
    catch(exception: PrismaClientKnownRequestError, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse();

        let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
        let code = 'INTERNAL_SERVER_ERROR';
        let message = 'An error occurred';
        let field: string | undefined;

        switch (exception.code) {
            case 'P2002':
                statusCode = HttpStatus.CONFLICT;
                code = 'UNIQUE_CONSTRAINT_FAILED';
                message = `${exception.meta?.target?.[0]} already exists`;
                field = exception.meta?.target?.[0];
                break;
            case 'P2003':
                statusCode = HttpStatus.BAD_REQUEST;
                code = 'FOREIGN_KEY_CONSTRAINT_FAILED';
                message = 'Invalid reference';
                break;
            case 'P2025':
                statusCode = HttpStatus.NOT_FOUND;
                code = 'RECORD_NOT_FOUND';
                message = 'Resource not found';
                break;
        }

        response.status(statusCode).json({
            statusCode,
            code,
            error: message,
            ...(field && { field }),
        });
    }
}
```

---

## HTTP Status Codes

| Status | Usage | Example |
|--------|-------|---------|
| **200** | Success (GET, PATCH, DELETE) | Client updated successfully |
| **201** | Created (POST) | New client created |
| **400** | Validation error | Missing required field |
| **401** | Unauthorized | Missing or invalid auth token |
| **403** | Forbidden | User lacks permission |
| **404** | Not found | Client ID doesn't exist |
| **409** | Conflict | Duplicate email address |
| **500** | Server error | Unexpected error |

---

## Client-Side Usage

### Using TanStack Query

```typescript
import { useQuery, useMutation } from '@tanstack/react-query';
import axios from 'axios';

// Fetch list
const { data, isLoading } = useQuery({
    queryKey: ['clients', page, limit],
    queryFn: async () => {
        const response = await axios.get('/api/clients', {
            params: { page, limit },
        });
        return response.data;
    },
});

// Create
const { mutate: createClient } = useMutation({
    mutationFn: async (data) => {
        const response = await axios.post('/api/clients', data);
        return response.data;
    },
    onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
});

// Update
const { mutate: updateClient } = useMutation({
    mutationFn: async ({ id, data }) => {
        const response = await axios.patch(`/api/clients/${id}`, data);
        return response.data;
    },
    onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
});

// Delete
const { mutate: deleteClient } = useMutation({
    mutationFn: async (id) => {
        await axios.delete(`/api/clients/${id}`);
    },
    onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
});
```

---

## Summary Checklist

- [ ] All client API calls route through `/api/*` routes
- [ ] Authentication token extracted from cookies in API routes
- [ ] Backend routes use plural nouns (`/clients`, not `/client`)
- [ ] Custom actions use `PATCH :id/{action}` pattern
- [ ] Pagination includes `page`, `limit`, `total`, `totalPages`
- [ ] Error responses include `statusCode`, `code`, `error`, optional `field`
- [ ] Prisma errors mapped to appropriate HTTP status codes
- [ ] Controllers guarded with `@UseGuards(JwtGuard)`
- [ ] Dynamic routes use `Promise<>` for params
- [ ] Client-side uses TanStack Query for caching and invalidation
