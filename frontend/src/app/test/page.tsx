import { api } from "@/app/lib/axios/client";

const TestPage = () => {
    const testAPI = async () => {
        const { data } = await api.get('/users/ac5f25d7-f8cc-4c68-82a5-db6dc2968c5f');
        return data;
    }
    return <div data-component="test"><pre>{JSON.stringify(testAPI(), null, 2)}</pre></div>;
};

export default TestPage;