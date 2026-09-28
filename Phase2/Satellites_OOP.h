#pragma once
#include <iostream>
#include <fstream>
#include <sstream>
#include <string>
#include <iomanip>

extern int REPAIR_DURATION_TICKS;

struct Debris {
    int id;
    Vector3 pos;
    Vector3 vel;
};

inline Debris* findDebrisById(std::vector<Debris> &list, int id) {
    for (int i = 0; i < list.size(); i++) {
        if (list[i].id == id) return &list[i];
    }
    return NULL;
}

class Satellite {
protected: 
    int id;
    std::string name;
    Vector3 pos, vel;
    double battery, software, fuel;
    
    // OOP Unit 2: Added 'sensorsOk' to track the new hardware state
    bool thrusterOk, sensorsOk, disabled; 
    
    int repairTicksRemaining;
    CircularQueue<double> batteryHistory; 

public:
    Satellite(int id_, std::string name_, Vector3 pos_, Vector3 vel_) {
        id = id_;
        name = name_;
        pos = pos_;
        vel = vel_;
        battery = 100;
        software = 100;
        fuel = 50;
        thrusterOk = true;
        sensorsOk = true; 
        disabled = false;
        repairTicksRemaining = 0;
    }
    
    virtual ~Satellite() {}

    virtual std::string getType() = 0;
    virtual void runDiagnostics(std::ofstream &logFile, double simTime) = 0;
    virtual std::string getStatusLine() = 0;

    void moveOneStep(double dt) {
        if (disabled) return;
        pos = pos + vel * dt;
        battery -= 0.02 * dt;
        if (battery < 0) battery = 0;
        batteryHistory.push(battery);
    }

    void burn(Vector3 dv) { vel = vel + dv; }
    
    bool useFuel(double amount) {
        if (fuel < amount) return false;
        fuel -= amount; 
        return true;
    }

    double getAvgBattery() {
        std::vector<double> vals = batteryHistory.getAll();
        if (vals.empty()) return battery;
        double sum = 0;
        for (int i = 0; i < vals.size(); i++) {
            sum += vals[i];
        }
        return sum / vals.size();
    }

    
    void hitBySolarFlare(double amount) { 
        software -= amount; 
        if (software < 0) software = 0;
    }
    
    void hitByBatteryDrain(double amount) { 
        battery -= amount; 
        if (battery < 0) battery = 0;
    }
    
    void hitByThrusterFailure() { thrusterOk = false; }
    
  
    void hitByProgramBug() {
        software -= 35.0; 
        if (software < 0) software = 0;
    }

   
    void hitBySensorFault() { sensorsOk = false; }
   

    void autoPatch(std::ofstream &logFile, double simTime, std::string detail) {
        std::cout << ">> " << name << " software patched automatically (" << detail << ")\n";
        logFile << "[t=" << simTime << "s] [PATCH] " << name << " auto-patched: " << detail << "\n";
        software = 100;
    }

    void sendForRepair(std::ofstream &logFile, double simTime, std::string reason) {
        if (disabled) return;
        disabled = true;
        repairTicksRemaining = REPAIR_DURATION_TICKS;
        std::cout << ">> " << name << " sent DISPATCH MANIFEST for physical repair (" << reason << ")\n";
        logFile << "[t=" << simTime << "s] [DISPATCH] " << name << " needs repair. Reason: " << reason << "\n";
    }

    void tickRepair(std::ofstream &logFile, double simTime) {
        if (!disabled) return;
        
        if (repairTicksRemaining > 0) repairTicksRemaining--;
        
        if (repairTicksRemaining <= 0) {
            disabled = false; 
            thrusterOk = true; 
            sensorsOk = true; 
            software = 100; 
            battery = 100;
            
            fuel += 25.0;
            if(fuel > 50.0) fuel = 50.0;
            
            std::cout << ">> " << name << " REPAIR COMPLETE - back ONLINE!\n";
            logFile << "[t=" << simTime << "s] [REPAIR] " << name << " repaired and back online\n";
        }
    }
    
    int getId() { return id; }
    std::string getName() { return name; }
    Vector3 getPos() { return pos; }
    Vector3 getVel() { return vel; }
    double getFuel() { return fuel; }
    bool isThrusterOk() { return thrusterOk; }
    bool areSensorsOk() { return sensorsOk; } 
    bool isDisabled() { return disabled; }
};
