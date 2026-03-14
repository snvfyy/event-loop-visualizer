// Why does this print 3, 3, 3 instead of 0, 1, 2?
// Each setTimeout callback closes over the same `i` variable (var is function-scoped).
// By the time the callbacks run, the loop has finished and i === 3.
for (var i = 0; i < 3; i++) {
  setTimeout(() => console.log(i), 0);
}
// Output: 3, 3, 3
