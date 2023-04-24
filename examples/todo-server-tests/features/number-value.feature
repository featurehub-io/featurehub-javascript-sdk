Feature: Checks number feature

  @FEATURE_NUMBER_1  @number
  Scenario: Check a number value
    Given I have a user called "Wilma"
    And I wipe my list of todos
    When I have added a new to-do item "pay"
    Then my list of todos should contain "pay 1"

  @FEATURE_NUMBER_DEC   @number
  Scenario: Check another number value
    Given I have a user called "Wilma"
    And I wipe my list of todos
    When I have added a new to-do item "pay"
    Then my list of todos should contain "pay 507598.258978"

  @FEATURE_NUMBER_ZERO   @number
  Scenario: Check zero number value
    Given I have a user called "Wilma"
    And I wipe my list of todos
    When I have added a new to-do item "pay"
    Then my list of todos should contain "pay 0"

  @FEATURE_NUMBER_NEG   @number
  Scenario: Check negative number value
    Given I have a user called "Wilma"
    And I wipe my list of todos
    When I have added a new to-do item "pay"
    Then my list of todos should contain "pay -16746.43"

  @FEATURE_NUMBER_NULL   @number
  Scenario: Check null number value
    Given I have a user called "Wilma"
    And I wipe my list of todos
    When I have added a new to-do item "pay"
    Then my list of todos should contain "pay"

  @number
  Scenario: Check number lock function
    Given I lock the feature "FEATURE_NUMBER"
    When I attempt to update feature "FEATURE_NUMBER" to number value "35"
    Then I should not be able to update the value

  @number
  Scenario: Check number value cannot be updated with string values
    Given I set the flag "FEATURE_NUMBER" to "foo"
    Then I should not be able to update the value
