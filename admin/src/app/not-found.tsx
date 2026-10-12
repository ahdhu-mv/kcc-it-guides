import { ErrorView } from "@/components/ErrorView";

export default function NotFound() {
  return <ErrorView error={{ status: 404, title: "Page not found", message: "That page doesn't exist." }} />;
}
