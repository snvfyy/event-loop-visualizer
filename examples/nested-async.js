// Microtasks drain completely between each macrotask.
// Microtasks scheduled inside microtasks also run before the next macrotask.
console.log('1');
setTimeout(() => {
  console.log('5');
  Promise.resolve().then(() => console.log('6'));
}, 0);
Promise.resolve().then(() => {
  console.log('3');
  setTimeout(() => console.log('7'), 0);
});
Promise.resolve().then(() => console.log('4'));
console.log('2');
// Output: 1, 2, 3, 4, 5, 6, 7
