export const delay = (ms) => new Promise((res) => setTimeout(res, ms));
export const getRandomJitter = (min = 1000, max = 3500) =>
  Math.floor(Math.random() * (max - min) + min);
export const humanLikeClick = async (page, selector) => {
  const element = await page.waitForSelector(selector);
  const box = await element.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
    steps: 10,
  });
  await page.click(selector);
};
