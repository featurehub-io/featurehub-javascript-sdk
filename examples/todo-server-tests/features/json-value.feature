@FEATURE_TITLE_TO_UPPERCASE_OFF
Feature: Checks json feature

  @FEATURE_JSON_BAR
  Scenario: Test json feature value
    Given I have a user called "Wilma"
    And I wipe my list of todos
    When I have added a new to-do item "find"
    Then my list of todos should contain "find bar"

  @FEATURE_JSON_BAZ
  Scenario: Test another json feature value
    Given I have a user called "Wilma"
    And I wipe my list of todos
    When I have added a new to-do item "find"
    Then my list of todos should contain "find baz"

  @FEATURE_JSON_NULL
  Scenario: Test null json value
    Given I have a user called "Wilma"
    And I wipe my list of todos
    When I have added a new to-do item "find"
    Then my list of todos should contain "find"

#  Scenario: Check json lock function
#    Given I lock the feature "FEATURE_JSON"
#    When I attempt to update feature "FEATURE_JSON" to json value "foo:"bar""
#    Then I should not be able to update the value

  Scenario: Check json value cannot be updated with string values
    Given I set the flag "FEATURE_JSON" to "foo"
    Then I should not be able to update the value
