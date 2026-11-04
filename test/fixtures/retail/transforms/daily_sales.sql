SELECT
  c.email,
  DATE(o.ordered_at) AS day,
  SUM(o.total) AS total
FROM {{ tables.orders }} AS o
JOIN {{ tables.customers }} AS c ON c.id = o.customer_id
GROUP BY c.email, DATE(o.ordered_at)
