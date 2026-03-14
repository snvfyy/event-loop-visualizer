// async/await is syntactic sugar over promises.
// Everything after `await` runs as a microtask, not synchronously.
async function fetchData() {
  console.log('1 - start');
  const result = await Promise.resolve('data');
  console.log('2 - after await: ' + result);
}
fetchData();
console.log('3 - sync after call');
// Output: 1 - start, 3 - sync after call, 2 - after await: data
