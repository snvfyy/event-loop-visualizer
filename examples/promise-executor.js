// The Promise executor runs synchronously — it's not async!
// Only the .then() callback is queued as a microtask.
console.log('1');
new Promise(resolve => {
  console.log('2 - executor is sync!');
  resolve();
}).then(() => console.log('4 - microtask'));
console.log('3');
// Output: 1, 2 - executor is sync!, 3, 4 - microtask
