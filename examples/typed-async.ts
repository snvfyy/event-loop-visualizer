interface User {
  id: number;
  name: string;
}

function fetchUser(id: number): Promise<User> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({ id, name: 'Alice' });
    }, 50);
  });
}

async function main(): Promise<void> {
  console.log('fetching user...');
  const user: User = await fetchUser(1);
  console.log('got: ' + user.name);
}

main();
