UPDATE employee
SET grade = CASE
    WHEN grade IN ('1급', '프리미엄') THEN '프리미엄'
    WHEN grade IN ('2급', '베스트') THEN '베스트'
    WHEN grade IN ('3급', '스텐다드', '스탠다드') THEN '스탠다드'
    ELSE grade
END
WHERE grade IN ('1급', '2급', '3급', '프리미엄', '베스트', '스텐다드', '스탠다드');
