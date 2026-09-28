import fs from "node:fs";

const source = fs.readFileSync(require.resolve("@/components/app/employees/EmployeeDirectoryManager"), "utf8");

describe("EmployeesPage deletion conflicts", () => {
  it("should close the confirmation and show the backend conflict guidance", () => {
    const handler = source.slice(
      source.indexOf("const handleDeleteConfirm"),
      source.indexOf("const handleFormDialogClose"),
    );

    expect(handler).toContain("setDeleteTargetEmployeeId(null)");
    expect(handler).toContain('operation: "mutation"');
    expect(handler).toContain("normalizeApiError");
    expect(handler).not.toContain("getApiErrorMessage");
    expect(source).toContain('dataComponent={`${dataComponent}_delete-error-notification`}');
  });

  it("uses semantic stat colors for assignment availability", () => {
    expect(source).toContain(
      'label: filterItems[1].label, counter: "명", colorIndex: 2',
    );
    expect(source).toContain(
      'label: filterItems[2].label, counter: "명", colorIndex: 0',
    );
  });

  it("counts search matches using the same availability predicates as the tabs", () => {
    expect(source).toContain("const matchedEmployees = searchMatchedEmployees ?? allEmployees");
    expect(source).toContain('available: matchedEmployees.filter((e: Employee) => e.openToNextWork === true).length');
    expect(source).toContain('unavailable: matchedEmployees.filter((e: Employee) => e.openToNextWork === false).length');
    expect(source).toContain('label: filterItems[0].label, counter: "명"');
    expect(source).toContain('label: filterItems[1].label');
    expect(source).toContain('label: filterItems[2].label');
    expect(source).toContain("OPEN_TO_NEXT_WORK_LABELS");
    expect(source).not.toContain('e.status === "working"');
  });

});
