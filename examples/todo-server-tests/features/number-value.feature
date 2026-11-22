@FEATURE_TITLE_TO_UPPERCASE_OFF
Feature: Checks number feature

  @FEATURE_NUMBER_1 @number @todo-api
  Scenario: Check a number value
    Given I have a user called "Wilma"
    And I wipe my list of todos
    When I have added a new to-do item "pay"
    Then my list of todos should contain "pay 1"

  @FEATURE_NUMBER_DEC @number @todo-api
  Scenario: Check another number value
    Given I have a user called "Wilma"
    And I wipe my list of todos
    When I have added a new to-do item "pay"
    Then my list of todos should contain "pay 507598.258978"

  @FEATURE_NUMBER_ZERO @number @todo-api
  Scenario: Check zero number value
    Given I have a user called "Wilma"
    And I wipe my list of todos
    When I have added a new to-do item "pay"
    Then my list of todos should contain "pay 0"

  @FEATURE_NUMBER_NEG @number @todo-api
  Scenario: Check negative number value
    Given I have a user called "Wilma"
    And I wipe my list of todos
    When I have added a new to-do item "pay"
    Then my list of todos should contain "pay -16746.43"

  @FEATURE_NUMBER_NULL @number @todo-api
  Scenario: Check null number value
    Given I have a user called "Wilma"
    And I wipe my list of todos
    When I have added a new to-do item "pay"
    Then my list of todos should contain "pay"

  @number @numberlock @featurehub-only
  Scenario: Check number lock function
    Given I set the flag "FEATURE_NUMBER" to "26"
    Then feature FEATURE_NUMBER is unlocked and "26"
    And I lock the feature "FEATURE_NUMBER"
    Then feature FEATURE_NUMBER is locked and "26"
    When I attempt to update feature "FEATURE_NUMBER" to number value "35"
    Then I should not be able to update the value

  @number @featurehub-only
  Scenario: Check number value cannot be updated with string values
    Given I set the flag "FEATURE_NUMBER" to "foo"
    Then I should not be able to update the value
