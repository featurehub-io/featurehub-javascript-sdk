Feature: Checks string feature

  @FEATURE_STRING_MILK
  Scenario: Check a string value
    Given I have a user called "Wilma"
    And I wipe my list of todos
    When I have added a new to-do item "buy"
    Then my list of todos should contain "buy milk"

  @FEATURE_STRING_BREAD
  Scenario: Check another string value
    Given I have a user called "Wilma"
    And I wipe my list of todos
    When I have added a new to-do item "buy"
    Then my list of todos should contain "buy bread"

  @FEATURE_STRING_MULTI
  Scenario: Check string value with multiple words
    Given I have a user called "Wilma"
    And I wipe my list of todos
    When I have added a new to-do item "buy"
    Then my list of todos should contain "buy foo bar baz"

  @FEATURE_STRING_EMPTY
  Scenario: Check empty string value
    Given I have a user called "Wilma"
    And I wipe my list of todos
    When I have added a new to-do item "buy"
    Then my list of todos should contain "buy"

  @FEATURE_STRING_NULL
  Scenario: Check null string value
    Given I have a user called "Wilma"
    And I wipe my list of todos
    When I have added a new to-do item "buy"
    Then my list of todos should contain "buy"

  Scenario: Check string lock function
    Given I lock the feature "FEATURE_STRING"
    When I attempt to update feature "FEATURE_STRING" to string value "run"
    Then I should not be able to update the value

