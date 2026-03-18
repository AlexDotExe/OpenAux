import { redirect } from 'next/navigation';

export default function AdminSignUpPage() {
  redirect('/admin/sign-in');
}
